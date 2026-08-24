/** Enforces the optional rolling model-spend policy and exposes one per-call accounting lifecycle to every LLM client. */

import { type ModelConfig, type ModelSpendLimits } from "../../config/index.ts";
import type { Database } from "../../database/index.ts";
import { calculateModelCostUsd, resolveModelPrice } from "./pricing.ts";

const SPEND_LOCK = 1_450_701_649;
const MAX_CONCURRENT_PROVIDER_CALLS = 10;

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type SpendWindowRow = {
  estimatedSpendUsd: string;
  retryAfterSeconds: number | null;
};

export type SpendCall = {
  record(usage: TokenUsage): Promise<void>;
  release(): void;
};

let spendLimit: SpendLimit | undefined;

export function configureSpendLimit(
  database: Database,
  limits: ModelSpendLimits | undefined,
): void {
  spendLimit = limits ? new SpendLimit(database, limits) : undefined;
}

export async function startSpendCall(model: ModelConfig): Promise<SpendCall> {
  const release = await providerCapacity.acquire();
  const limit = spendLimit;
  try {
    await limit?.assertCanSpend(model);
  } catch (error) {
    release();
    throw error;
  }
  let recorded = false;
  return {
    async record(usage) {
      if (recorded) return;
      recorded = true;
      await limit?.record(model, usage);
    },
    release,
  };
}

class ProviderCapacity {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
    } else {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) {
        next();
      } else {
        this.#active -= 1;
      }
    };
  }
}

const providerCapacity = new ProviderCapacity(MAX_CONCURRENT_PROVIDER_CALLS);

class SpendLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;

  constructor(retryAfterSeconds: number, limits: ModelSpendLimits) {
    super(
      `The shared deployment has reached its estimated $${limits.spendUsd} model-spend limit for the last ${limits.windowHours} hours.`,
    );
    this.name = "SpendLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class SpendLimit {
  readonly #database: Database;
  readonly #limits: ModelSpendLimits;

  constructor(database: Database, limits: ModelSpendLimits) {
    this.#database = database;
    this.#limits = limits;
  }

  async assertCanSpend(model: ModelConfig): Promise<void> {
    await resolveModelPrice(model.id);
    await this.#database.transaction(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(${SPEND_LOCK})`;
      await sql`
        DELETE FROM model_cost_events
        WHERE recorded_at < now() - make_interval(hours => ${this.#limits.windowHours})
      `;
      const [window] = await sql<SpendWindowRow[]>`
        WITH ordered_costs AS (
          SELECT
            recorded_at,
            SUM(estimated_cost_usd) OVER () AS total_cost,
            SUM(estimated_cost_usd) OVER (ORDER BY recorded_at, id) AS cumulative_cost
          FROM model_cost_events
        )
        SELECT
          COALESCE(MAX(total_cost), 0)::text AS estimated_spend_usd,
          GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM (
              MIN(recorded_at) FILTER (
                WHERE total_cost - cumulative_cost < ${this.#limits.spendUsd}
              ) + make_interval(hours => ${this.#limits.windowHours}) - now()
            )))::integer
          ) AS retry_after_seconds
        FROM ordered_costs
      `;
      if (Number(window?.estimatedSpendUsd ?? 0) >= this.#limits.spendUsd) {
        throw new SpendLimitError(window?.retryAfterSeconds ?? 1, this.#limits);
      }
    });
  }

  async record(model: ModelConfig, usage: TokenUsage): Promise<void> {
    const inputTokens = normalizeTokenCount(usage.inputTokens);
    const outputTokens = normalizeTokenCount(usage.outputTokens);
    if (inputTokens === 0 && outputTokens === 0) return;
    const price = await resolveModelPrice(model.id);
    const estimatedCostUsd = calculateModelCostUsd(price, { inputTokens, outputTokens });
    await this.#database.run(
      (sql) => sql`
      INSERT INTO model_cost_events (
        model_id,
        input_tokens,
        output_tokens,
        estimated_cost_usd
      )
      VALUES (
        ${model.id},
        ${inputTokens},
        ${outputTokens},
        ${estimatedCostUsd}
      )
    `,
    );
  }
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
