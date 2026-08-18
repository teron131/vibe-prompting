/** Enforces the deployment-wide rolling model-spend circuit breaker from persisted token usage and resolved model pricing. */

import { resolveModelPrice } from "./clients/openrouter-pricing.ts";
import type { ModelConfig } from "./config.ts";
import type { Database } from "./database.ts";

export const MODEL_SPEND_LIMIT_USD = 20;

const MODEL_SPEND_INTERVAL = "1 day";
const MODEL_SPEND_LOCK = 1_450_701_649;
const TOKENS_PER_MILLION = 1_000_000;

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type SpendWindowRow = {
  estimatedSpendUsd: string;
  retryAfterSeconds: number | null;
};

export class ModelSpendLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;

  constructor(retryAfterSeconds: number) {
    super(
      `The shared deployment has reached its estimated $${MODEL_SPEND_LIMIT_USD} model-spend limit for the last 24 hours.`,
    );
    this.name = "ModelSpendLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ModelSpendLimit {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async assertCanSpend(model: ModelConfig): Promise<void> {
    await resolveModelPrice(model.id);
    await this.#database.transaction(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(${MODEL_SPEND_LOCK})`;
      await sql`
        DELETE FROM model_cost_events
        WHERE recorded_at < now() - ${MODEL_SPEND_INTERVAL}::interval
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
                WHERE total_cost - cumulative_cost < ${MODEL_SPEND_LIMIT_USD}
              ) + ${MODEL_SPEND_INTERVAL}::interval - now()
            )))::integer
          ) AS retry_after_seconds
        FROM ordered_costs
      `;
      if (Number(window?.estimatedSpendUsd ?? 0) >= MODEL_SPEND_LIMIT_USD) {
        throw new ModelSpendLimitError(window?.retryAfterSeconds ?? 1);
      }
    });
  }

  async record(model: ModelConfig, usage: ModelTokenUsage): Promise<void> {
    const inputTokens = normalizeTokenCount(usage.inputTokens);
    const outputTokens = normalizeTokenCount(usage.outputTokens);
    if (inputTokens === 0 && outputTokens === 0) return;
    const price = await resolveModelPrice(model.id);
    const estimatedCostUsd =
      (inputTokens * price.inputPricePerMillionTokens +
        outputTokens * price.outputPricePerMillionTokens) /
      TOKENS_PER_MILLION;
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

let configuredSpendLimit: ModelSpendLimit | undefined;

export function configureModelSpendLimit(database: Database): ModelSpendLimit {
  configuredSpendLimit = new ModelSpendLimit(database);
  return configuredSpendLimit;
}

export function getModelSpendLimit(): ModelSpendLimit | undefined {
  return configuredSpendLimit;
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
