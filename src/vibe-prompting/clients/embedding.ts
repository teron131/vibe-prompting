/** Generates the native Gemini embeddings used by shared hybrid search. */

import { loadRuntimeConfig } from "../config/index.ts";

export const SEARCH_EMBEDDING_MODEL = "gemini-embedding-2";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const SEARCH_EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_BATCH_SIZE = 32;
const EMBEDDING_BATCH_CONCURRENCY = 4;
const QUERY_CACHE_MAX_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 30_000;

const queryEmbeddings = new Map<string, Promise<number[]>>();

type GeminiBatchEmbeddingResponse = {
  embeddings?: Array<{ values?: unknown }>;
};

/** Distinguishes actionable provider failures from ordinary empty search results. */
export class EmbeddingError extends Error {
  readonly statusCode = 502;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}

/** Embeds retrieval documents in bounded batches while preserving input order. */
export async function embedSearchDocuments(documents: Array<{ text: string; title: string }>) {
  if (documents.length === 0) return [];

  const apiKey = loadEmbeddingApiKey();
  const batches: string[][] = [];
  for (let index = 0; index < documents.length; index += EMBEDDING_BATCH_SIZE) {
    batches.push(
      documents
        .slice(index, index + EMBEDDING_BATCH_SIZE)
        .map(({ text, title }) => `title: ${title} | text: ${text}`),
    );
  }

  const embeddings: number[][][] = new Array(batches.length);
  let nextBatch = 0;
  await Promise.all(
    Array.from({ length: Math.min(EMBEDDING_BATCH_CONCURRENCY, batches.length) }, async () => {
      while (nextBatch < batches.length) {
        const index = nextBatch++;
        embeddings[index] = await embedBatch(batches[index]!, apiKey);
      }
    }),
  );
  return embeddings.flat();
}

/** Embeds one asymmetric retrieval query using Gemini Embedding 2's search format. */
export async function embedSearchQuery(query: string) {
  const apiKey = loadEmbeddingApiKey();
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const cacheKey = `${SEARCH_EMBEDDING_MODEL}:${normalizedQuery}`;
  const cached = queryEmbeddings.get(cacheKey);
  if (cached) {
    queryEmbeddings.delete(cacheKey);
    queryEmbeddings.set(cacheKey, cached);
    return cached;
  }

  const pending = embedBatch([`task: search result | query: ${normalizedQuery}`], apiKey).then(
    ([embedding]) => {
      if (!embedding) throw new EmbeddingError("Gemini returned no query embedding.");
      return embedding;
    },
  );
  queryEmbeddings.set(cacheKey, pending);
  if (queryEmbeddings.size > QUERY_CACHE_MAX_ENTRIES) {
    const oldest = queryEmbeddings.keys().next().value;
    if (oldest) queryEmbeddings.delete(oldest);
  }
  try {
    return await pending;
  } catch (error) {
    if (queryEmbeddings.get(cacheKey) === pending) queryEmbeddings.delete(cacheKey);
    throw error;
  }
}

function loadEmbeddingApiKey() {
  const config = loadRuntimeConfig();
  if (
    config.embeddingModel.id !== SEARCH_EMBEDDING_MODEL ||
    config.embeddingModel.platform !== "gemini"
  ) {
    throw new EmbeddingError(
      `Set embeddingModel to ${SEARCH_EMBEDDING_MODEL} on the gemini platform to enable semantic search.`,
    );
  }
  const apiKey = config.platforms.gemini.apiKey;
  if (!apiKey) throw new EmbeddingError("Set GEMINI_API_KEY to enable semantic search.");
  return apiKey;
}

async function embedBatch(contents: string[], apiKey: string): Promise<number[][]> {
  if (contents.length === 0) return [];

  const model = `models/${SEARCH_EMBEDDING_MODEL}`;
  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_BASE_URL}/${model}:batchEmbedContents`, {
      body: JSON.stringify({
        requests: contents.map((content) => ({
          content: { parts: [{ text: content }] },
          embedContentConfig: {
            outputDimensionality: SEARCH_EMBEDDING_DIMENSIONS,
          },
          model,
        })),
      }),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "Gemini embedding timed out. Try searching again."
        : "Gemini embedding could not be reached. Try searching again.";
    throw new EmbeddingError(message, { cause: error });
  }

  if (!response.ok) {
    throw new EmbeddingError(
      `Gemini embedding rejected the request (${response.status}). Check GEMINI_API_KEY and the configured embedding model.`,
    );
  }

  let payload: GeminiBatchEmbeddingResponse;
  try {
    payload = (await response.json()) as GeminiBatchEmbeddingResponse;
  } catch (error) {
    throw new EmbeddingError("Gemini embedding returned invalid JSON.", { cause: error });
  }
  const embeddings = payload.embeddings?.map(({ values }) => values);
  if (
    !embeddings ||
    embeddings.length !== contents.length ||
    embeddings.some(
      (embedding) =>
        !Array.isArray(embedding) ||
        embedding.length !== SEARCH_EMBEDDING_DIMENSIONS ||
        embedding.some((value) => typeof value !== "number" || !Number.isFinite(value)),
    )
  ) {
    throw new EmbeddingError("Gemini embedding returned an invalid response.");
  }
  return embeddings as number[][];
}
