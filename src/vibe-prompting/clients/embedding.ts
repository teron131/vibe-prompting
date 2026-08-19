/** Generates the native Gemini embeddings used by hybrid saved-prompt search. */

import { loadRuntimeConfig } from "../config.ts";

export const PROMPT_SEARCH_EMBEDDING_MODEL = "gemini-embedding-2";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const PROMPT_SEARCH_EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_BATCH_SIZE = 32;
const REQUEST_TIMEOUT_MS = 30_000;

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
  const embeddings: number[][] = [];
  for (let index = 0; index < documents.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = documents.slice(index, index + EMBEDDING_BATCH_SIZE);
    embeddings.push(
      ...(await embedBatch(batch.map(({ text, title }) => `title: ${title} | text: ${text}`))),
    );
  }
  return embeddings;
}

/** Embeds one asymmetric retrieval query using Gemini Embedding 2's search format. */
export async function embedSearchQuery(query: string) {
  const [embedding] = await embedBatch([`task: search result | query: ${query}`]);
  if (!embedding) throw new EmbeddingError("Gemini returned no query embedding.");
  return embedding;
}

async function embedBatch(contents: string[]): Promise<number[][]> {
  if (contents.length === 0) return [];

  const config = loadRuntimeConfig();
  if (
    config.embeddingModel.id !== PROMPT_SEARCH_EMBEDDING_MODEL ||
    config.embeddingModel.platform !== "gemini"
  ) {
    throw new EmbeddingError(
      `Set embeddingModel to ${PROMPT_SEARCH_EMBEDDING_MODEL} on the gemini platform to enable semantic prompt search.`,
    );
  }
  const apiKey = config.platforms.gemini.apiKey;
  if (!apiKey) throw new EmbeddingError("Set GEMINI_API_KEY to enable semantic prompt search.");

  const model = `models/${PROMPT_SEARCH_EMBEDDING_MODEL}`;
  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_BASE_URL}/${model}:batchEmbedContents`, {
      body: JSON.stringify({
        requests: contents.map((content) => ({
          content: { parts: [{ text: content }] },
          embedContentConfig: {
            outputDimensionality: PROMPT_SEARCH_EMBEDDING_DIMENSIONS,
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
        embedding.length !== PROMPT_SEARCH_EMBEDDING_DIMENSIONS ||
        embedding.some((value) => typeof value !== "number" || !Number.isFinite(value)),
    )
  ) {
    throw new EmbeddingError("Gemini embedding returned an invalid response.");
  }
  return embeddings as number[][];
}
