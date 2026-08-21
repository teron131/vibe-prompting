/** Owns target-agnostic hybrid matching, ranking, and its durable embedding cache. */

import { createHash } from "node:crypto";

import { cosineSimilarity } from "ai";
import type postgres from "postgres";

import {
  embedSearchDocuments,
  embedSearchQuery,
  SEARCH_EMBEDDING_DIMENSIONS,
  SEARCH_EMBEDDING_MODEL,
} from "./clients/embedding.ts";
import type { Database } from "./database.ts";

const MIN_SEMANTIC_SIMILARITY = 0.6;
const SEMANTIC_SIMILARITY_WINDOW = 0.08;
const EMBEDDING_UPSERT_CHUNK_SIZE = 250;

/** Carries one target-specific searchable projection and the value returned when it matches. */
export type SearchDocument<T> = {
  documentId: string;
  ownerId: string;
  title: string;
  text: string;
  updatedAt: string;
  value: T;
};

/** Carries the shared ranking scores alongside the original target projection. */
export type SearchHit<T> = {
  document: SearchDocument<T>;
  keyword: number;
  semantic: number;
  score: number;
};

type CachedEmbedding = {
  documentId: string;
  ownerId: string;
  contentHash: string;
  model: string;
  embedding: unknown;
};

type SearchCandidate<T> = {
  document: SearchDocument<T>;
  contentHash: string;
  keyword: number;
};

/** Applies one keyword-plus-semantic ranking policy to documents projected by each search target. */
export class HybridSearch {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Ranks matching documents and persists embeddings only for the candidate set that can affect the result. */
  async search<T>(
    target: string,
    query: string,
    documents: SearchDocument<T>[],
  ): Promise<SearchHit<T>[]> {
    const { normalizedQuery, normalizedTarget } = normalizeSearchInput(target, query);
    if (!normalizedQuery || documents.length === 0) return [];

    const scoredDocuments = scoreKeywords(normalizedQuery, documents);
    const keywordMatches = scoredDocuments.filter((candidate) => candidate.keyword > 0);
    return this.#rank(
      normalizedTarget,
      normalizedQuery,
      keywordMatches.length > 0 ? keywordMatches : scoredDocuments,
      keywordMatches.length > 0,
    );
  }

  /** Returns membership-equivalent matches without paying for semantic ranking when keyword matches already determine the set. */
  async findMatches<T>(
    target: string,
    query: string,
    documents: SearchDocument<T>[],
  ): Promise<SearchDocument<T>[]> {
    const { normalizedQuery, normalizedTarget } = normalizeSearchInput(target, query);
    if (!normalizedQuery || documents.length === 0) return [];

    const scoredDocuments = scoreKeywords(normalizedQuery, documents);
    const keywordMatches = scoredDocuments.filter((candidate) => candidate.keyword > 0);
    if (keywordMatches.length > 0) return keywordMatches.map(({ document }) => document);
    return (await this.#rank(normalizedTarget, normalizedQuery, scoredDocuments, false)).map(
      ({ document }) => document,
    );
  }

  async #rank<T>(
    target: string,
    query: string,
    scoredDocuments: Array<{ document: SearchDocument<T>; keyword: number }>,
    hasKeywordMatches: boolean,
  ): Promise<SearchHit<T>[]> {
    const selected = scoredDocuments.map((candidate) => ({
      ...candidate,
      contentHash: hashDocument(candidate.document),
    }));
    const [embeddingByDocumentId, queryEmbedding] = await Promise.all([
      this.#refreshEmbeddings(target, selected),
      embedSearchQuery(query),
    ]);
    return rankCandidates(selected, embeddingByDocumentId, queryEmbedding, hasKeywordMatches);
  }

  async #refreshEmbeddings<T>(
    target: string,
    candidates: SearchCandidate<T>[],
  ): Promise<Map<string, number[]>> {
    const cached = await loadCachedEmbeddings(
      this.#database,
      target,
      candidates.map(({ document }) => document.documentId),
    );
    const cachedByDocumentId = new Map(cached.map((row) => [row.documentId, row] as const));
    const pending = candidates.filter((candidate) => {
      const row = cachedByDocumentId.get(candidate.document.documentId);
      return (
        !row ||
        row.ownerId !== candidate.document.ownerId ||
        row.contentHash !== candidate.contentHash ||
        row.model !== SEARCH_EMBEDDING_MODEL ||
        !isEmbedding(row.embedding)
      );
    });
    const pendingEmbeddings = await embedSearchDocuments(
      pending.map(({ document }) => ({ text: document.text, title: document.title })),
    );
    const embeddingByDocumentId = new Map<string, number[]>();
    for (const row of cached) {
      if (isEmbedding(row.embedding)) embeddingByDocumentId.set(row.documentId, row.embedding);
    }
    for (const [index, candidate] of pending.entries()) {
      const embedding = pendingEmbeddings[index];
      if (!embedding) throw new Error("A search embedding was not generated.");
      embeddingByDocumentId.set(candidate.document.documentId, embedding);
    }
    if (pending.length > 0) {
      await upsertEmbeddings(this.#database, target, pending, embeddingByDocumentId);
    }
    return embeddingByDocumentId;
  }
}

function normalizeSearchInput(target: string, query: string) {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) throw new Error("A search target is required.");
  return { normalizedQuery: query.replace(/\s+/g, " ").trim(), normalizedTarget };
}

function scoreKeywords<T>(query: string, documents: SearchDocument<T>[]) {
  const normalizedQuery = query.toLocaleLowerCase();
  const tokenPatterns = (normalizedQuery.match(/[\p{L}\p{N}]+/gu) ?? []).map(
    createWholeTermPattern,
  );
  const queryPattern = createWholeTermPattern(normalizedQuery);
  return documents.map((document) => ({
    document,
    keyword: getKeywordScore({
      normalizedQuery,
      queryPattern,
      text: document.text,
      title: document.title,
      tokenPatterns,
    }),
  }));
}

async function loadCachedEmbeddings(
  database: Database,
  target: string,
  documentIds: string[],
): Promise<CachedEmbedding[]> {
  return database.run(
    (sql) => sql<CachedEmbedding[]>`
      SELECT document_id, owner_id, content_hash, model, embedding
      FROM search_embeddings
      WHERE target = ${target}
        AND document_id = ANY(${documentIds}::text[])
    `,
  );
}

async function upsertEmbeddings<T>(
  database: Database,
  target: string,
  candidates: SearchCandidate<T>[],
  embeddingByDocumentId: Map<string, number[]>,
): Promise<void> {
  await database.transaction(async (sql) => {
    const rowsByDocumentId = new Map(
      candidates.map((candidate) => {
        const { document } = candidate;
        const embedding = embeddingByDocumentId.get(document.documentId);
        if (!embedding) throw new Error("A search embedding was not generated.");
        return [
          document.documentId,
          {
            target,
            document_id: document.documentId,
            owner_id: document.ownerId,
            content_hash: candidate.contentHash,
            model: SEARCH_EMBEDDING_MODEL,
            embedding: sql.json(embedding as postgres.JSONValue),
          },
        ] as const;
      }),
    );
    const rows = [...rowsByDocumentId.values()];
    for (let offset = 0; offset < rows.length; offset += EMBEDDING_UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + EMBEDDING_UPSERT_CHUNK_SIZE);
      await sql`
        INSERT INTO search_embeddings ${sql(chunk, "target", "document_id", "owner_id", "content_hash", "model", "embedding")}
        ON CONFLICT (target, document_id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          content_hash = EXCLUDED.content_hash,
          model = EXCLUDED.model,
          embedding = EXCLUDED.embedding
      `;
    }
  });
}

function rankCandidates<T>(
  candidates: Array<Pick<SearchCandidate<T>, "document" | "keyword">>,
  embeddingByDocumentId: Map<string, number[]>,
  queryEmbedding: number[],
  hasKeywordMatches: boolean,
): SearchHit<T>[] {
  const scored = candidates.map((candidate) => {
    const embedding = embeddingByDocumentId.get(candidate.document.documentId) ?? [];
    return {
      ...candidate,
      semantic:
        embedding.length === queryEmbedding.length
          ? cosineSimilarity(queryEmbedding, embedding)
          : 0,
    };
  });
  const maxKeyword = Math.max(0, ...scored.map((candidate) => candidate.keyword));
  const minSemantic = Math.min(...scored.map((candidate) => candidate.semantic));
  const maxSemantic = Math.max(...scored.map((candidate) => candidate.semantic));
  return scored
    .map((candidate) => {
      const keyword = maxKeyword > 0 ? candidate.keyword / maxKeyword : 0;
      const semantic =
        maxSemantic === minSemantic
          ? Math.max(0, candidate.semantic)
          : (candidate.semantic - minSemantic) / (maxSemantic - minSemantic);
      return {
        document: candidate.document,
        keyword: candidate.keyword,
        semantic: candidate.semantic,
        score: hasKeywordMatches ? keyword * 0.5 + semantic * 0.5 : semantic,
      };
    })
    .filter(
      (candidate) =>
        hasKeywordMatches ||
        (candidate.semantic >= MIN_SEMANTIC_SIMILARITY &&
          candidate.semantic >= maxSemantic - SEMANTIC_SIMILARITY_WINDOW),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.document.updatedAt) - Date.parse(left.document.updatedAt) ||
        left.document.documentId.localeCompare(right.document.documentId),
    );
}

function hashDocument<T>(document: SearchDocument<T>): string {
  return createHash("sha256")
    .update(`title: ${document.title} | text: ${document.text}`)
    .digest("hex");
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === SEARCH_EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function getKeywordScore({
  normalizedQuery,
  queryPattern,
  text,
  title,
  tokenPatterns,
}: {
  normalizedQuery: string;
  queryPattern: RegExp;
  text: string;
  title: string;
  tokenPatterns: RegExp[];
}): number {
  const normalizedTitle = title.toLocaleLowerCase();
  const normalizedText = text.toLocaleLowerCase();
  let score = 0;
  if (normalizedTitle === normalizedQuery) score += 12;
  if (queryPattern.test(normalizedTitle)) score += 6;
  if (queryPattern.test(normalizedText)) score += 4;
  for (const tokenPattern of tokenPatterns) {
    if (tokenPattern.test(normalizedTitle)) score += 2;
    if (tokenPattern.test(normalizedText)) score += 0.75;
  }
  return score;
}

function createWholeTermPattern(term: string): RegExp {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedTerm}($|[^\\p{L}\\p{N}])`, "iu");
}
