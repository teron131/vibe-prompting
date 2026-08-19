/** Builds and caches passage-level hybrid search for the current revisions owned by PromptSystem. */

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
import type { StoredPrompt } from "./system.ts";

const MAX_PASSAGE_CHARACTERS = 1_200;
const MAX_PASSAGE_RESULTS = 30;
const MAX_PROMPT_RESULTS = 10;
const MAX_PASSAGES_PER_PROMPT = 3;
const MIN_SEMANTIC_SIMILARITY = 0.6;
const SEMANTIC_SIMILARITY_WINDOW = 0.08;

export type PromptPassage = {
  promptId: string;
  end: number;
  revisionId: string;
  start: number;
  text: string;
};

export type PromptPassageHit = PromptPassage & {
  score: number;
  title: string;
  updatedAt: string;
};

export type StoredPromptSearchResult = StoredPrompt & { passages: PromptPassageHit[] };

type SearchPassage = PromptPassage & {
  prompt: StoredPrompt;
  chunkIndex: number;
  contentHash: string;
  searchText: string;
};

type RankedPassage = SearchPassage & { keyword: number; score: number; semantic: number };

type CachedSearchPassage = {
  chunkIndex: number;
  contentHash: string;
  embedding: unknown;
  model: string;
  promptId: string;
  revisionId: string;
};

export type PromptSearch = ReturnType<typeof createPromptSearch>;

export function createPromptSearch(
  database: Database,
  listCurrentPrompts: () => Promise<StoredPrompt[]>,
) {
  async function searchPassages(query: string, promptId?: string): Promise<PromptPassageHit[]> {
    const ranked = await rankCurrentPassages(query);
    return ranked
      .filter((passage) => !promptId || passage.promptId === promptId)
      .slice(0, MAX_PASSAGE_RESULTS)
      .map(projectPassageHit);
  }

  async function searchPrompts(query: string): Promise<StoredPromptSearchResult[]> {
    const ranked = await rankCurrentPassages(query);
    const results = new Map<string, StoredPromptSearchResult>();
    for (const passage of ranked) {
      let result = results.get(passage.promptId);
      if (!result) {
        if (results.size >= MAX_PROMPT_RESULTS) continue;
        result = { ...passage.prompt, passages: [] };
        results.set(passage.promptId, result);
      }
      if (result.passages.length < MAX_PASSAGES_PER_PROMPT) {
        result.passages.push(projectPassageHit(passage));
      }
    }
    return [...results.values()];
  }

  async function rankCurrentPassages(query: string): Promise<RankedPassage[]> {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    if (!normalizedQuery) return [];
    const [prompts, cachedPassages] = await Promise.all([
      listCurrentPrompts(),
      loadCachedPassages(database),
    ]);
    const passages = buildSearchPassages(prompts);
    if (passages.length === 0) return [];
    const embeddingByKey = await refreshEmbeddings(database, passages, cachedPassages);
    const queryEmbedding = await embedSearchQuery(normalizedQuery);
    return rankPassages({ embeddingByKey, passages, query: normalizedQuery, queryEmbedding });
  }

  return { searchPrompts, searchPassages };
}

async function loadCachedPassages(database: Database): Promise<CachedSearchPassage[]> {
  return database.run(
    (sql) => sql<CachedSearchPassage[]>`
      SELECT prompt_id, chunk_index, revision_id, content_hash, model, embedding
      FROM prompt_search_embeddings
    `,
  );
}

async function refreshEmbeddings(
  database: Database,
  passages: SearchPassage[],
  cachedPassages: CachedSearchPassage[],
): Promise<Map<string, number[]>> {
  const cacheByKey = new Map(
    cachedPassages.map(
      (passage) => [getPassageKey(passage.promptId, passage.chunkIndex), passage] as const,
    ),
  );
  const pendingPassages = passages.filter((passage) => {
    const cached = cacheByKey.get(getPassageKey(passage.promptId, passage.chunkIndex));
    return (
      !cached ||
      cached.revisionId !== passage.revisionId ||
      cached.contentHash !== passage.contentHash ||
      cached.model !== PROMPT_SEARCH_EMBEDDING_MODEL ||
      !isEmbedding(cached.embedding)
    );
  });
  const pendingEmbeddings = await embedSearchDocuments(
    pendingPassages.map((passage) => ({ text: passage.searchText, title: passage.prompt.title })),
  );
  const embeddingByKey = new Map<string, number[]>();
  for (const cached of cachedPassages) {
    if (isEmbedding(cached.embedding)) {
      embeddingByKey.set(getPassageKey(cached.promptId, cached.chunkIndex), cached.embedding);
    }
  }
  for (const [index, passage] of pendingPassages.entries()) {
    const embedding = pendingEmbeddings[index];
    if (embedding)
      embeddingByKey.set(getPassageKey(passage.promptId, passage.chunkIndex), embedding);
  }

  const currentKeys = new Set(
    passages.map((passage) => getPassageKey(passage.promptId, passage.chunkIndex)),
  );
  const changedPromptIds = new Set(pendingPassages.map((passage) => passage.promptId));
  for (const cached of cachedPassages) {
    if (!currentKeys.has(getPassageKey(cached.promptId, cached.chunkIndex))) {
      changedPromptIds.add(cached.promptId);
    }
  }
  if (changedPromptIds.size > 0) {
    await replaceCachedPassages(database, passages, changedPromptIds, embeddingByKey);
  }
  return embeddingByKey;
}

async function replaceCachedPassages(
  database: Database,
  passages: SearchPassage[],
  promptIds: Set<string>,
  embeddingByKey: Map<string, number[]>,
): Promise<void> {
  await database.transaction(async (sql) => {
    const ids = [...promptIds];
    await sql`DELETE FROM prompt_search_embeddings WHERE prompt_id = ANY(${ids}::uuid[])`;
    for (const passage of passages) {
      if (!promptIds.has(passage.promptId)) continue;
      const embedding = embeddingByKey.get(getPassageKey(passage.promptId, passage.chunkIndex));
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
          ${passage.promptId},
          ${passage.chunkIndex},
          ${passage.revisionId},
          ${passage.contentHash},
          ${PROMPT_SEARCH_EMBEDDING_MODEL},
          ${sql.json(embedding as postgres.JSONValue)}
        )
      `;
    }
  });
}

function buildSearchPassages(prompts: StoredPrompt[]): SearchPassage[] {
  return prompts.flatMap((prompt) => {
    const promptPassages = splitMarkdownPassages(prompt.markdown);
    const passages =
      promptPassages.length > 0
        ? promptPassages
        : [{ end: 0, heading: "", start: 0, text: prompt.title }];
    return passages.map((passage, chunkIndex) => {
      const searchText = passage.heading ? `${passage.heading}\n${passage.text}` : passage.text;
      const document = `title: ${prompt.title} | text: ${searchText}`;
      return {
        ...passage,
        prompt,
        promptId: prompt.id,
        chunkIndex,
        contentHash: createHash("sha256").update(document).digest("hex"),
        revisionId: prompt.revisionId,
        searchText,
      };
    });
  });
}

function splitMarkdownPassages(
  markdown: string,
): Array<{ end: number; heading: string; start: number; text: string }> {
  if (!markdown) return [];
  const passages: Array<{ end: number; heading: string; start: number; text: string }> = [];
  let heading = "";
  let blockStart: number | undefined;
  let blockEnd = 0;
  const addBlock = () => {
    if (blockStart === undefined) return;
    const raw = markdown.slice(blockStart, blockEnd);
    for (const part of splitBlock(raw, blockStart)) {
      passages.push({ ...part, heading, text: cleanDisplayText(part.text) });
    }
    blockStart = undefined;
  };
  for (const line of markdown.matchAll(/[^\n]*(?:\n|$)/g)) {
    const lineStart = line.index ?? 0;
    const raw = line[0];
    const markdown = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const headingMatch = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(markdown);
    if (headingMatch) {
      addBlock();
      heading = headingMatch[1] ?? "";
    } else if (!markdown.trim()) {
      addBlock();
    } else {
      blockStart ??= lineStart;
      blockEnd = lineStart + markdown.length;
    }
  }
  addBlock();
  if (passages.length === 0) {
    const text = cleanDisplayText(markdown);
    return text ? [{ end: markdown.length, heading, start: 0, text }] : [];
  }
  return passages;
}

function splitBlock(
  text: string,
  offset: number,
): Array<{ end: number; start: number; text: string }> {
  if (text.length <= MAX_PASSAGE_CHARACTERS) {
    return [{ end: offset + text.length, start: offset, text }];
  }
  const parts: Array<{ end: number; start: number; text: string }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + MAX_PASSAGE_CHARACTERS, text.length);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end) + 1);
      if (boundary > cursor + MAX_PASSAGE_CHARACTERS / 2) end = boundary;
    }
    const raw = text.slice(cursor, end);
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const trailingWhitespace = raw.length - raw.trimEnd().length;
    const start = offset + cursor + leadingWhitespace;
    const finish = offset + end - trailingWhitespace;
    if (finish > start)
      parts.push({ end: finish, start, text: text.slice(start - offset, finish - offset) });
    cursor = end;
  }
  return parts;
}

function getPassageKey(promptId: string, chunkIndex: number): string {
  return `${promptId}:${chunkIndex}`;
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === PROMPT_SEARCH_EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function rankPassages({
  embeddingByKey,
  passages,
  query,
  queryEmbedding,
}: {
  embeddingByKey: Map<string, number[]>;
  passages: SearchPassage[];
  query: string;
  queryEmbedding: number[];
}): RankedPassage[] {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const candidates = passages.map((passage) => {
    const embedding = embeddingByKey.get(getPassageKey(passage.promptId, passage.chunkIndex)) ?? [];
    return {
      keyword: getKeywordScore({
        query,
        text: passage.searchText,
        title: passage.prompt.title,
        tokens,
      }),
      passage,
      semantic:
        embedding.length === queryEmbedding.length
          ? cosineSimilarity(queryEmbedding, embedding)
          : 0,
    };
  });
  const maxKeyword = Math.max(0, ...candidates.map((candidate) => candidate.keyword));
  const minSemantic = Math.min(...candidates.map((candidate) => candidate.semantic));
  const maxSemantic = Math.max(...candidates.map((candidate) => candidate.semantic));
  const ranked = candidates.map((candidate) => {
    const keyword = maxKeyword > 0 ? candidate.keyword / maxKeyword : 0;
    const semantic =
      maxSemantic === minSemantic
        ? Math.max(0, candidate.semantic)
        : (candidate.semantic - minSemantic) / (maxSemantic - minSemantic);
    return {
      ...candidate.passage,
      keyword: candidate.keyword,
      score: maxKeyword > 0 ? keyword * 0.5 + semantic * 0.5 : semantic,
      semantic: candidate.semantic,
    };
  });
  const hasKeywordMatches = ranked.some((candidate) => candidate.keyword > 0);
  return ranked
    .filter((candidate) =>
      hasKeywordMatches
        ? candidate.keyword > 0
        : candidate.semantic >= MIN_SEMANTIC_SIMILARITY &&
          candidate.semantic >= maxSemantic - SEMANTIC_SIMILARITY_WINDOW,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.prompt.updatedAt) - Date.parse(left.prompt.updatedAt) ||
        left.start - right.start,
    );
}

function projectPassageHit(passage: RankedPassage): PromptPassageHit {
  return {
    promptId: passage.promptId,
    end: passage.end,
    revisionId: passage.revisionId,
    score: passage.score,
    start: passage.start,
    text: passage.text,
    title: passage.prompt.title,
    updatedAt: passage.prompt.updatedAt,
  };
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

function cleanDisplayText(text: string): string {
  return text
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_~>#|]+/g, " ")
    .replace(/[┌┐└┘├┤┬┴┼─│▼▲←→]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
