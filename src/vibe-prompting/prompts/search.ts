/** Builds, caches, and ranks the hybrid keyword and semantic saved-prompt index. */

import { createHash } from "node:crypto";

import { cosineSimilarity } from "ai";
import type postgres from "postgres";

import {
  embedSearchDocuments,
  embedSearchQuery,
  PROMPT_SEARCH_EMBEDDING_DIMENSIONS,
  PROMPT_SEARCH_EMBEDDING_MODEL,
} from "../clients/embedding.ts";
import type { Database } from "../database.ts";
import type { PromptStore, StoredPrompt } from "./store.ts";

const MAX_CHUNK_CHARACTERS = 6_000;
const MAX_RESULTS = 10;
const MIN_SEMANTIC_SIMILARITY = 0.6;
const SEMANTIC_SIMILARITY_WINDOW = 0.08;
const SNIPPET_CHARACTERS = 160;

type SearchChunk = {
  chunkIndex: number;
  contentHash: string;
  prompt: StoredPrompt;
  text: string;
};

type CachedSearchChunk = {
  chunkIndex: number;
  contentHash: string;
  embedding: unknown;
  model: string;
  promptId: string;
  revisionId: string;
};

export type StoredPromptSearchResult = StoredPrompt & { snippet: string };

export class PromptSearch {
  readonly #database: Database;
  readonly #prompts: PromptStore;

  constructor(database: Database, prompts: PromptStore) {
    this.#database = database;
    this.#prompts = prompts;
  }

  /** Searches current prompt revisions and refreshes only stale semantic index chunks. */
  async search(query: string): Promise<StoredPromptSearchResult[]> {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    const [prompts, cachedChunks] = await Promise.all([
      this.#prompts.listPrompts(),
      this.#loadCachedChunks(),
    ]);
    const chunks = buildSearchChunks(prompts);
    if (chunks.length === 0) return [];

    const embeddingByKey = await this.#refreshEmbeddings(chunks, cachedChunks);
    const queryEmbedding = await embedSearchQuery(normalizedQuery);
    return rankChunks({ chunks, embeddingByKey, query: normalizedQuery, queryEmbedding });
  }

  async #loadCachedChunks(): Promise<CachedSearchChunk[]> {
    return this.#database.run(
      (sql) => sql<CachedSearchChunk[]>`
      SELECT prompt_id, chunk_index, revision_id, content_hash, model, embedding
      FROM prompt_search_embeddings
    `,
    );
  }

  async #refreshEmbeddings(
    chunks: SearchChunk[],
    cachedChunks: CachedSearchChunk[],
  ): Promise<Map<string, number[]>> {
    const cacheByKey = new Map(
      cachedChunks.map((chunk) => [getChunkKey(chunk.promptId, chunk.chunkIndex), chunk] as const),
    );
    const pendingChunks = chunks.filter((chunk) => {
      const cached = cacheByKey.get(getChunkKey(chunk.prompt.id, chunk.chunkIndex));
      return (
        !cached ||
        cached.revisionId !== chunk.prompt.revisionId ||
        cached.contentHash !== chunk.contentHash ||
        cached.model !== PROMPT_SEARCH_EMBEDDING_MODEL ||
        !isEmbedding(cached.embedding)
      );
    });
    const pendingEmbeddings = await embedSearchDocuments(
      pendingChunks.map((chunk) => ({ text: chunk.text, title: chunk.prompt.title })),
    );
    const embeddingByKey = new Map<string, number[]>();
    for (const cached of cachedChunks) {
      if (isEmbedding(cached.embedding)) {
        embeddingByKey.set(getChunkKey(cached.promptId, cached.chunkIndex), cached.embedding);
      }
    }
    for (const [index, chunk] of pendingChunks.entries()) {
      const embedding = pendingEmbeddings[index];
      if (embedding) embeddingByKey.set(getChunkKey(chunk.prompt.id, chunk.chunkIndex), embedding);
    }

    const currentKeys = new Set(
      chunks.map((chunk) => getChunkKey(chunk.prompt.id, chunk.chunkIndex)),
    );
    const changedPromptIds = new Set(pendingChunks.map((chunk) => chunk.prompt.id));
    for (const cached of cachedChunks) {
      if (!currentKeys.has(getChunkKey(cached.promptId, cached.chunkIndex))) {
        changedPromptIds.add(cached.promptId);
      }
    }
    if (changedPromptIds.size > 0) {
      await this.#replaceCachedChunks(chunks, changedPromptIds, embeddingByKey);
    }
    return embeddingByKey;
  }

  async #replaceCachedChunks(
    chunks: SearchChunk[],
    promptIds: Set<string>,
    embeddingByKey: Map<string, number[]>,
  ): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const ids = [...promptIds];
      await sql`DELETE FROM prompt_search_embeddings WHERE prompt_id = ANY(${ids}::uuid[])`;
      for (const chunk of chunks) {
        if (!promptIds.has(chunk.prompt.id)) continue;
        const embedding = embeddingByKey.get(getChunkKey(chunk.prompt.id, chunk.chunkIndex));
        if (!embedding) throw new Error("A prompt search embedding was not generated.");
        await sql`
          INSERT INTO prompt_search_embeddings (
            prompt_id,
            chunk_index,
            revision_id,
            content_hash,
            model,
            embedding
          )
          VALUES (
            ${chunk.prompt.id},
            ${chunk.chunkIndex},
            ${chunk.prompt.revisionId},
            ${chunk.contentHash},
            ${PROMPT_SEARCH_EMBEDDING_MODEL},
            ${sql.json(embedding as postgres.JSONValue)}
          )
        `;
      }
    });
  }
}

function buildSearchChunks(prompts: StoredPrompt[]): SearchChunk[] {
  return prompts.flatMap((prompt) => {
    const textChunks = splitLongText(prompt.markdown || prompt.title);
    return textChunks.map((text, chunkIndex) => {
      const document = `title: ${prompt.title} | text: ${text}`;
      return {
        chunkIndex,
        contentHash: createHash("sha256").update(document).digest("hex"),
        prompt,
        text,
      };
    });
  });
}

function splitLongText(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += MAX_CHUNK_CHARACTERS) {
    chunks.push(text.slice(start, start + MAX_CHUNK_CHARACTERS));
  }
  return chunks;
}

function getChunkKey(promptId: string, chunkIndex: number): string {
  return `${promptId}:${chunkIndex}`;
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === PROMPT_SEARCH_EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function rankChunks({
  chunks,
  embeddingByKey,
  query,
  queryEmbedding,
}: {
  chunks: SearchChunk[];
  embeddingByKey: Map<string, number[]>;
  query: string;
  queryEmbedding: number[];
}): StoredPromptSearchResult[] {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const candidates = chunks.map((chunk) => {
    const embedding = embeddingByKey.get(getChunkKey(chunk.prompt.id, chunk.chunkIndex)) ?? [];
    return {
      chunk,
      keyword: getKeywordScore({ query, text: chunk.text, title: chunk.prompt.title, tokens }),
      semantic:
        embedding.length === queryEmbedding.length
          ? cosineSimilarity(queryEmbedding, embedding)
          : 0,
    };
  });
  let maxKeyword = 0;
  let minSemantic = Number.POSITIVE_INFINITY;
  let maxSemantic = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    maxKeyword = Math.max(maxKeyword, candidate.keyword);
    minSemantic = Math.min(minSemantic, candidate.semantic);
    maxSemantic = Math.max(maxSemantic, candidate.semantic);
  }
  const bestByPrompt = new Map<string, (typeof candidates)[number] & { score: number }>();
  for (const candidate of candidates) {
    const keyword = maxKeyword > 0 ? candidate.keyword / maxKeyword : 0;
    const semantic =
      maxSemantic === minSemantic
        ? Math.max(0, candidate.semantic)
        : (candidate.semantic - minSemantic) / (maxSemantic - minSemantic);
    const score = maxKeyword > 0 ? keyword * 0.5 + semantic * 0.5 : semantic;
    const current = bestByPrompt.get(candidate.chunk.prompt.id);
    if (!current || score > current.score) {
      bestByPrompt.set(candidate.chunk.prompt.id, { ...candidate, score });
    }
  }

  const rankedPrompts = [...bestByPrompt.values()].sort(
    (left, right) =>
      right.score - left.score ||
      Date.parse(right.chunk.prompt.updatedAt) - Date.parse(left.chunk.prompt.updatedAt),
  );
  const hasKeywordMatches = rankedPrompts.some(({ keyword }) => keyword > 0);
  return rankedPrompts
    .filter(({ keyword, semantic }) =>
      hasKeywordMatches
        ? keyword > 0
        : semantic >= MIN_SEMANTIC_SIMILARITY &&
          semantic >= maxSemantic - SEMANTIC_SIMILARITY_WINDOW,
    )
    .slice(0, MAX_RESULTS)
    .map(({ chunk }) => ({
      ...chunk.prompt,
      snippet: createSnippet(chunk.text, query, tokens),
    }));
}

function getKeywordScore({
  query,
  text,
  title,
  tokens,
}: {
  query: string;
  text: string;
  title: string;
  tokens: string[];
}): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedTitle = title.toLocaleLowerCase();
  const normalizedText = text.toLocaleLowerCase();
  let score = 0;
  if (normalizedTitle === normalizedQuery) score += 12;
  if (containsWholeTerm(normalizedTitle, normalizedQuery)) score += 6;
  if (containsWholeTerm(normalizedText, normalizedQuery)) score += 4;
  for (const token of tokens) {
    if (containsWholeTerm(normalizedTitle, token)) score += 2;
    if (containsWholeTerm(normalizedText, token)) score += 0.75;
  }
  return score;
}

function containsWholeTerm(text: string, term: string): boolean {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedTerm}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function createSnippet(text: string, query: string, tokens: string[]): string {
  const cleanText = cleanSnippetText(text);
  const normalizedText = cleanText.toLocaleLowerCase();
  const phraseIndex = normalizedText.indexOf(query.toLocaleLowerCase());
  const tokenIndex = tokens.reduce((best, token) => {
    const index = normalizedText.indexOf(token);
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  const matchIndex = phraseIndex >= 0 ? phraseIndex : tokenIndex;
  const start = Math.max(0, (matchIndex >= 0 ? matchIndex : 0) - 60);
  const snippet = cleanText.slice(start, start + SNIPPET_CHARACTERS).trim();
  return `${start > 0 ? "…" : ""}${snippet}${start + SNIPPET_CHARACTERS < cleanText.length ? "…" : ""}`;
}

function cleanSnippetText(text: string): string {
  return text
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_~>#|]+/g, " ")
    .replace(/[┌┐└┘├┤┬┴┼─│▼▲←→]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
