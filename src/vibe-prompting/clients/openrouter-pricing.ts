/** Reproduces Model Atlas effective pricing from OpenRouter provider prices weighted by reported token volume. */

import { z } from "zod";

import { resolveModelCatalogId } from "./models-dev.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/frontend/v1/catalog/models";
const OPENROUTER_PRICING_URL = "https://openrouter.ai/api/frontend/v1/stats/effective-pricing";
const CACHE_TTL_MS = 60 * 60 * 1000;
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
type OpenRouterDirectory = {
  permaslugBySlug: Map<string, string>;
  slugs: string[];
};
type TimedPromise<T> = { expiresAt: number; promise: Promise<T> };

export type ModelPrice = {
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
};

let directoryCache: TimedPromise<OpenRouterDirectory> | undefined;
const priceCache = new Map<string, TimedPromise<ModelPrice>>();

export async function resolveModelPrice(id: string): Promise<ModelPrice> {
  const catalogId = await resolveModelCatalogId(id);
  const cached = priceCache.get(catalogId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = loadModelPrice(catalogId);
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, promise };
  priceCache.set(catalogId, entry);
  void promise.catch(() => {
    if (priceCache.get(catalogId) === entry) priceCache.delete(catalogId);
  });
  return promise;
}

async function loadModelPrice(catalogId: string): Promise<ModelPrice> {
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
      return { inputPricePerMillionTokens, outputPricePerMillionTokens };
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
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, promise };
  directoryCache = entry;
  void promise.catch(() => {
    if (directoryCache === entry) directoryCache = undefined;
  });
  return promise;
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
