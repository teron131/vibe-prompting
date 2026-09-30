/** Projects active context revisions into passages and maps shared hybrid-search hits back to context results. */

import type { HybridSearch } from "../search.ts";
import type { StoredContext } from "./system.ts";

const MAX_PASSAGE_CHARACTERS = 1_200;
const MAX_PASSAGE_RESULTS = 30;
const MAX_CONTEXT_RESULTS = 10;
const MAX_PASSAGES_PER_CONTEXT = 3;

export type ContextPassage = {
  contextId: string;
  end: number;
  revisionId: string;
  start: number;
  text: string;
};

export type ContextPassageHit = ContextPassage & {
  score: number;
  title: string;
  updatedAt: string;
};

export type StoredContextSearchResult = StoredContext & { passages: ContextPassageHit[] };

type SearchPassage = ContextPassage & {
  context: StoredContext;
  chunkIndex: number;
  searchText: string;
};

type RankedPassage = SearchPassage & { keyword: number; score: number; semantic: number };

export type ContextSearch = ReturnType<typeof createContextSearch>;

/** Adapts active context revisions into shared-search documents and groups passage hits by context. */
export function createContextSearch(
  hybridSearch: HybridSearch,
  listActiveContexts: () => Promise<StoredContext[]>,
) {
  /** Returns ranked passage excerpts, optionally restricted to one context. */
  async function searchPassages(query: string, contextId?: string): Promise<ContextPassageHit[]> {
    const ranked = await rankActivePassages(query);
    return ranked
      .filter((passage) => !contextId || passage.contextId === contextId)
      .slice(0, MAX_PASSAGE_RESULTS)
      .map(projectPassageHit);
  }

  /** Returns the highest-ranked contexts while retaining up to three useful passages per context. */
  async function searchContexts(query: string): Promise<StoredContextSearchResult[]> {
    const ranked = await rankActivePassages(query);
    const results = new Map<string, StoredContextSearchResult>();
    for (const passage of ranked) {
      let result = results.get(passage.contextId);
      if (!result) {
        if (results.size >= MAX_CONTEXT_RESULTS) continue;
        result = { ...passage.context, passages: [] };
        results.set(passage.contextId, result);
      }
      if (result.passages.length < MAX_PASSAGES_PER_CONTEXT) {
        result.passages.push(projectPassageHit(passage));
      }
    }
    return [...results.values()];
  }

  async function rankActivePassages(query: string): Promise<RankedPassage[]> {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    if (!normalizedQuery) return [];
    const contexts = await listActiveContexts();
    const passages = buildSearchPassages(contexts);
    if (passages.length === 0) return [];
    const hits = await hybridSearch.search(
      "context",
      normalizedQuery,
      passages.map((passage) => ({
        documentId: getPassageKey(passage.contextId, passage.chunkIndex),
        ownerId: passage.contextId,
        title: passage.context.title,
        text: passage.searchText,
        updatedAt: passage.context.updatedAt,
        value: passage,
      })),
    );
    return hits.map(({ document, keyword, score, semantic }) => ({
      ...document.value,
      keyword,
      score,
      semantic,
    }));
  }

  return { searchContexts, searchPassages };
}

function buildSearchPassages(contexts: StoredContext[]): SearchPassage[] {
  return contexts.flatMap((context) => {
    const contextPassages = splitMarkdownPassages(context.markdown);
    const passages =
      contextPassages.length > 0
        ? contextPassages
        : [{ end: 0, heading: "", start: 0, text: context.title }];
    return passages.map((passage, chunkIndex) => {
      const searchText = passage.heading ? `${passage.heading}\n${passage.text}` : passage.text;
      return {
        ...passage,
        context,
        contextId: context.id,
        chunkIndex,
        revisionId: context.revisionId,
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

function getPassageKey(contextId: string, chunkIndex: number): string {
  return `${contextId}:${chunkIndex}`;
}

function projectPassageHit(passage: RankedPassage): ContextPassageHit {
  return {
    contextId: passage.contextId,
    end: passage.end,
    revisionId: passage.revisionId,
    score: passage.score,
    start: passage.start,
    text: passage.text,
    title: passage.context.title,
    updatedAt: passage.context.updatedAt,
  };
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
