/** Enforces the optional rolling model-spend policy and exposes one per-call accounting lifecycle to every LLM client. */

import { type ModelConfig, type ModelSpendLimits } from "../../config/index.ts";
import type { Database } from "../../database/index.ts";
import { calculateModelCostUsd, type ModelPricing } from "./pricing.ts";

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

/** Owns provider capacity and optional rolling spend limits for one application instance. */
export class ModelSpend {
  readonly #capacity = new ProviderCapacity(MAX_CONCURRENT_PROVIDER_CALLS);
  readonly #limit: SpendLimit | undefined;

  constructor(pricing: ModelPricing, database?: Database, limits?: ModelSpendLimits) {
    this.#limit = database && limits ? new SpendLimit(database, limits, pricing) : undefined;
  }

  /** Reserves capacity until usage recording and provider cleanup release it. */
  async start(model: ModelConfig): Promise<SpendCall> {
    const release = await this.#capacity.acquire();
    try {
      await this.#limit?.assertCanSpend(model);
    } catch (error) {
      release();
      throw error;
    }
    let recorded = false;
    return {
      record: async (usage) => {
        if (recorded) return;
        recorded = true;
        await this.#limit?.record(model, usage);
      },
      release,
    };
  }

  close(): Promise<void> {
    return this.#capacity.close();
  }
}

class ProviderCapacity {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  #closed = false;
  #idle: (() => void) | undefined;
  #closing: Promise<void> | undefined;

  constructor(limit: number) {
    this.#limit = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.#closed) throw new Error("Model provider capacity is closed.");
    if (this.#active < this.#limit) {
      this.#active += 1;
    } else {
      await new Promise<void>((resolve, reject) => this.#waiting.push({ resolve, reject }));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) {
        next.resolve();
      } else {
        this.#active -= 1;
        if (this.#active === 0) this.#idle?.();
      }
    };
  }
  close(): Promise<void> {
    this.#closing ??= new Promise<void>((resolve) => {
      this.#closed = true;
      for (const waiting of this.#waiting.splice(0))
        waiting.reject(new Error("Model provider capacity is closed."));
      if (this.#active === 0) resolve();
      else this.#idle = resolve;
    });
    return this.#closing;
  }
}

class SpendLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;

  constructor(retryAfterSeconds: number, limits: ModelSpendLimits) {
    super(
      `The workspace has reached its estimated $${limits.spendUsd} model-spend limit for the last ${limits.windowHours} hours.`,
    );
    this.name = "SpendLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class SpendLimit {
  readonly #database: Database;
  readonly #limits: ModelSpendLimits;
  readonly #pricing: ModelPricing;

  constructor(database: Database, limits: ModelSpendLimits, pricing: ModelPricing) {
    this.#pricing = pricing;
    this.#database = database;
    this.#limits = limits;
  }

  async assertCanSpend(model: ModelConfig): Promise<void> {
    await this.#pricing.resolve(model.id);
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
    const price = await this.#pricing.resolve(model.id);
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
