/** Resolves effective LLM pricing from OpenRouter provider prices weighted by reported token volume. */

import { z } from "zod";

import type { Database } from "../../database/index.ts";
import { resolveModelCatalogId } from "./models-dev.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/frontend/v1/catalog/models";
const OPENROUTER_PRICING_URL = "https://openrouter.ai/api/frontend/v1/stats/effective-pricing";
const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;
const STALE_PRICE_RETRY_MS = 5 * 60 * 1000;
const COST_ESTIMATE_WAIT_MS = 100;
const FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

const openRouterDirectorySchema = z.object({
  data: z.array(
    z.object({
      permaslug: z.string().trim().min(1).nullable().optional(),
      slug: z.string().trim().min(1).nullable().optional(),
    }),
  ),
});

const providerSummarySchema = z.object({
  effectiveInputPrice: z.number().finite().nullable().optional(),
  effectiveOutputPrice: z.number().finite().nullable().optional(),
  totalTokens: z.number().finite().nullable().optional(),
});

const effectivePricingSchema = z.object({
  data: z
    .object({
      providerSummaries: z.array(providerSummarySchema).optional(),
    })
    .nullable()
    .optional(),
});

type ProviderSummary = z.infer<typeof providerSummarySchema>;
type CachedModelPriceRow = {
  modelId: string;
  catalogId: string;
  permaslug: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  fetchedAt: Date;
};
type OpenRouterDirectory = {
  permaslugBySlug: Map<string, string>;
  slugs: string[];
};
type TimedPromise<T> = { expiresAt: number; promise: Promise<T> };
type ResolvedModelPrice = ModelPrice & {
  catalogId: string;
  permaslug: string;
  fetchedAt: number;
};

export type ModelPrice = {
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
};

type ModelTokenUsage = {
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
};

export type ModelCostEstimate = {
  calculate(usage: ModelTokenUsage): Promise<number | null>;
};

let directoryCache: TimedPromise<OpenRouterDirectory> | undefined;
const priceCache = new Map<string, TimedPromise<ModelPrice>>();
let priceDatabase: Database | undefined;

export function configureModelPriceCache(database: Database): void {
  priceDatabase = database;
  priceCache.clear();
}

export async function resolveModelPrice(id: string): Promise<ModelPrice> {
  const modelId = id.trim();
  const cached = priceCache.get(modelId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = loadCachedOrRemoteModelPrice(modelId);
  const entry = { expiresAt: Date.now() + STALE_PRICE_RETRY_MS, promise };
  priceCache.set(modelId, entry);
  void promise.catch(() => {
    if (priceCache.get(modelId) === entry) priceCache.delete(modelId);
  });
  return promise;
}

/** Starts price resolution alongside a model run and gives completion a bounded, non-blocking cost projection. */
export function startModelCostEstimate(modelId: string): ModelCostEstimate {
  const price = resolveModelPrice(modelId).catch(() => undefined);
  return {
    async calculate(usage) {
      const inputTokens = normalizeTokenCount(usage.inputTokens);
      const outputTokens = normalizeTokenCount(usage.outputTokens);
      if (inputTokens === 0 && outputTokens === 0) return null;
      const resolvedPrice = await resolveWithin(price, COST_ESTIMATE_WAIT_MS);
      if (!resolvedPrice) return null;
      return calculateModelCostUsd(resolvedPrice, { inputTokens, outputTokens });
    },
  };
}

export function calculateModelCostUsd(price: ModelPrice, usage: ModelTokenUsage): number {
  return (
    (normalizeTokenCount(usage.inputTokens) * price.inputPricePerMillionTokens +
      normalizeTokenCount(usage.outputTokens) * price.outputPricePerMillionTokens) /
    1_000_000
  );
}

async function loadCachedOrRemoteModelPrice(modelId: string): Promise<ModelPrice> {
  const stored = await readCachedModelPrice(modelId);
  if (stored) {
    const price = projectModelPrice(stored);
    const expiresAt = stored.fetchedAt + PRICE_FRESH_MS;
    if (expiresAt > Date.now()) {
      cacheResolvedPrice(modelId, price, expiresAt);
      return price;
    }
    cacheResolvedPrice(modelId, price, Date.now() + STALE_PRICE_RETRY_MS);
    void refreshModelPrice(modelId).catch(() => undefined);
    return price;
  }
  return refreshModelPrice(modelId);
}

async function refreshModelPrice(modelId: string): Promise<ModelPrice> {
  const resolved = await fetchModelPrice(modelId);
  await persistModelPrice(modelId, resolved).catch((error) => {
    console.warn(`Could not persist the OpenRouter price for ${modelId}.`, error);
  });
  const price = projectModelPrice(resolved);
  cacheResolvedPrice(modelId, price, resolved.fetchedAt + PRICE_FRESH_MS);
  return price;
}

async function fetchModelPrice(modelId: string): Promise<ResolvedModelPrice> {
  const catalogId = await resolveModelCatalogId(modelId);
  const directory = await loadOpenRouterDirectory();
  const permaslugs = resolvePermaslugCandidates(catalogId, directory);
  if (permaslugs.length === 0) {
    throw new Error(`OpenRouter does not contain a standard route for ${catalogId}.`);
  }

  let lastError: unknown;
  for (const permaslug of permaslugs) {
    try {
      const query = new URLSearchParams({ permaslug, variant: "standard" });
      const summaries =
        effectivePricingSchema.parse(
          await fetchJsonWithRetry(`${OPENROUTER_PRICING_URL}?${query}`, "OpenRouter pricing"),
        ).data?.providerSummaries ?? [];
      const inputPricePerMillionTokens = providerWeightedPrice(summaries, "effectiveInputPrice");
      const outputPricePerMillionTokens = providerWeightedPrice(summaries, "effectiveOutputPrice");
      if (inputPricePerMillionTokens === null || outputPricePerMillionTokens === null) {
        throw new Error(`OpenRouter does not publish complete provider pricing for ${permaslug}.`);
      }
      return {
        catalogId,
        permaslug,
        inputPricePerMillionTokens,
        outputPricePerMillionTokens,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`OpenRouter pricing is unavailable for ${catalogId}.`);
}

async function loadOpenRouterDirectory(): Promise<OpenRouterDirectory> {
  if (directoryCache && directoryCache.expiresAt > Date.now()) return directoryCache.promise;

  const promise = fetchJsonWithRetry(OPENROUTER_MODELS_URL, "OpenRouter catalog").then(
    (payload) => {
      const permaslugBySlug = new Map<string, string>();
      for (const model of openRouterDirectorySchema.parse(payload).data) {
        if (model.slug && model.permaslug) {
          permaslugBySlug.set(sanitizeModelId(model.slug), model.permaslug);
        }
      }
      return { permaslugBySlug, slugs: [...permaslugBySlug.keys()] };
    },
  );
  const entry = { expiresAt: Date.now() + PRICE_FRESH_MS, promise };
  directoryCache = entry;
  void promise.catch(() => {
    if (directoryCache === entry) directoryCache = undefined;
  });
  return promise;
}

async function readCachedModelPrice(modelId: string): Promise<ResolvedModelPrice | undefined> {
  const database = priceDatabase;
  if (!database) return undefined;
  let rows: CachedModelPriceRow[];
  try {
    rows = await database.run(
      (sql) => sql<CachedModelPriceRow[]>`
        SELECT
          model_id,
          catalog_id,
          permaslug,
          input_price_per_million_tokens,
          output_price_per_million_tokens,
          fetched_at
        FROM model_price_cache
        WHERE model_id = ${modelId}
      `,
    );
  } catch (error) {
    console.warn(`Could not read the cached OpenRouter price for ${modelId}.`, error);
    return undefined;
  }
  const [row] = rows;
  const fetchedAt = row?.fetchedAt.getTime();
  if (!row || fetchedAt === undefined || !Number.isFinite(fetchedAt)) return undefined;
  return {
    catalogId: row.catalogId,
    permaslug: row.permaslug,
    inputPricePerMillionTokens: row.inputPricePerMillionTokens,
    outputPricePerMillionTokens: row.outputPricePerMillionTokens,
    fetchedAt,
  };
}

async function persistModelPrice(modelId: string, price: ResolvedModelPrice): Promise<void> {
  const database = priceDatabase;
  if (!database) return;
  await database.run(
    (sql) => sql`
      INSERT INTO model_price_cache (
        model_id,
        catalog_id,
        permaslug,
        input_price_per_million_tokens,
        output_price_per_million_tokens,
        fetched_at
      )
      VALUES (
        ${modelId},
        ${price.catalogId},
        ${price.permaslug},
        ${price.inputPricePerMillionTokens},
        ${price.outputPricePerMillionTokens},
        ${new Date(price.fetchedAt)}
      )
      ON CONFLICT (model_id) DO UPDATE
      SET catalog_id = EXCLUDED.catalog_id,
          permaslug = EXCLUDED.permaslug,
          input_price_per_million_tokens = EXCLUDED.input_price_per_million_tokens,
          output_price_per_million_tokens = EXCLUDED.output_price_per_million_tokens,
          fetched_at = EXCLUDED.fetched_at
    `,
  );
}

function cacheResolvedPrice(modelId: string, price: ModelPrice, expiresAt: number): void {
  priceCache.set(modelId, { expiresAt, promise: Promise.resolve(price) });
}

function projectModelPrice(price: ModelPrice): ModelPrice {
  return {
    inputPricePerMillionTokens: price.inputPricePerMillionTokens,
    outputPricePerMillionTokens: price.outputPricePerMillionTokens,
  };
}

async function fetchJsonWithRetry(url: string, label: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS - 1) break;
      await retryDelay(attempt);
      continue;
    }
    if (response.ok) return response.json();
    const error = new Error(`${label} returned HTTP ${response.status}.`);
    if ((response.status !== 429 && response.status < 500) || attempt === FETCH_ATTEMPTS - 1) {
      throw error;
    }
    lastError = error;
    await retryDelay(attempt);
  }
  throw lastError ?? new Error(`${label} is unavailable.`);
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 100));
  });
}

async function resolveWithin<T>(
  promise: Promise<T | undefined>,
  waitMs: number,
): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, waitMs);
    }),
  ]);
}

function normalizeTokenCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resolvePermaslugCandidates(modelId: string, directory: OpenRouterDirectory): string[] {
  const normalized = sanitizeModelId(modelId);
  const versionCandidates = directory.slugs
    .filter((slug) => slug !== normalized && isSameOpenRouterModelRoute(normalized, slug))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);
  return [
    ...new Set(
      [normalized, ...versionCandidates].flatMap((slug) => {
        const permaslug = directory.permaslugBySlug.get(slug);
        return permaslug ? [permaslug] : [];
      }),
    ),
  ];
}

function isSameOpenRouterModelRoute(targetRoute: string, candidateRoute: string): boolean {
  const [targetProvider, targetModel = ""] = targetRoute.split("/", 2);
  const [candidateProvider, candidateModel = ""] = candidateRoute.split("/", 2);
  if (!targetProvider || !targetModel || targetProvider !== candidateProvider || !candidateModel) {
    return false;
  }
  const targetBase = stripVersionSuffix(targetModel);
  const candidateBase = stripVersionSuffix(candidateModel);
  if (targetBase !== candidateBase) return false;
  if (candidateModel === targetBase) return true;
  const suffix = candidateModel.slice(targetBase.length + 1);
  return candidateModel.startsWith(`${targetBase}-`) && isVersionSuffix(suffix);
}

function stripVersionSuffix(modelName: string): string {
  return modelName
    .replace(/-(?:preview|beta|experimental)(?:-\d{2,4}(?:-\d{2,4})*)?$/i, "")
    .replace(/-\d{8}$/i, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/i, "")
    .replace(/-\d{2}-\d{2}$/i, "")
    .replace(/-\d{2}-\d{4}$/i, "");
}

function isVersionSuffix(value: string): boolean {
  return (
    /^(?:preview|beta|experimental)(?:-\d{2,4}(?:-\d{2,4})*)?$/i.test(value) ||
    /^\d{8}$/i.test(value) ||
    /^\d{4}-\d{2}-\d{2}$/i.test(value) ||
    /^\d{2}-\d{2}$/i.test(value) ||
    /^\d{2}-\d{4}$/i.test(value)
  );
}

function providerWeightedPrice(
  providers: ProviderSummary[],
  priceField: "effectiveInputPrice" | "effectiveOutputPrice",
): number | null {
  if (providers.length === 0) return null;
  let weightedSum = 0;
  let totalTokens = 0;
  for (const provider of providers) {
    const price = provider[priceField];
    const tokens = provider.totalTokens;
    if (tokens === null || tokens === undefined || tokens < 0) return null;
    if (tokens === 0) continue;
    if (price === null || price === undefined || price < 0) return null;
    weightedSum += price * tokens;
    totalTokens += tokens;
  }
  return totalTokens > 0 ? weightedSum / totalTokens : null;
}

function sanitizeModelId(modelId: string): string {
  const normalized = modelId
    .trim()
    .toLowerCase()
    .replace(/:[a-z0-9._-]+$/i, "");
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0) return normalized;
  const provider = normalized.slice(0, slashIndex);
  return `${provider === "xai" ? "x-ai" : provider}${normalized.slice(slashIndex)}`;
}
