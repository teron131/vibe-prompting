/** Projects active prompt revisions into passages and maps shared hybrid-search hits back to prompt results. */

import type { HybridSearch } from "../search.ts";
import type { StoredPrompt } from "./system.ts";

const MAX_PASSAGE_CHARACTERS = 1_200;
const MAX_PASSAGE_RESULTS = 30;
const MAX_PROMPT_RESULTS = 10;
const MAX_PASSAGES_PER_PROMPT = 3;

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
  searchText: string;
};

type RankedPassage = SearchPassage & { keyword: number; score: number; semantic: number };

export type PromptSearch = ReturnType<typeof createPromptSearch>;

/** Adapts active prompt revisions into shared-search documents and groups passage hits by prompt. */
export function createPromptSearch(
  hybridSearch: HybridSearch,
  listActivePrompts: () => Promise<StoredPrompt[]>,
) {
  /** Returns ranked passage excerpts, optionally restricted to one prompt. */
  async function searchPassages(query: string, promptId?: string): Promise<PromptPassageHit[]> {
    const ranked = await rankActivePassages(query);
    return ranked
      .filter((passage) => !promptId || passage.promptId === promptId)
      .slice(0, MAX_PASSAGE_RESULTS)
      .map(projectPassageHit);
  }

  /** Returns the highest-ranked prompts while retaining up to three useful passages per prompt. */
  async function searchPrompts(query: string): Promise<StoredPromptSearchResult[]> {
    const ranked = await rankActivePassages(query);
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

  async function rankActivePassages(query: string): Promise<RankedPassage[]> {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    if (!normalizedQuery) return [];
    const prompts = await listActivePrompts();
    const passages = buildSearchPassages(prompts);
    if (passages.length === 0) return [];
    const hits = await hybridSearch.search(
      "prompt",
      normalizedQuery,
      passages.map((passage) => ({
        documentId: getPassageKey(passage.promptId, passage.chunkIndex),
        ownerId: passage.promptId,
        title: passage.prompt.title,
        text: passage.searchText,
        updatedAt: passage.prompt.updatedAt,
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

  return { searchPrompts, searchPassages };
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
      return {
        ...passage,
        prompt,
        promptId: prompt.id,
        chunkIndex,
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

function cleanDisplayText(text: string): string {
  return text
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_~>#|]+/g, " ")
    .replace(/[┌┐└┘├┤┬┴┼─│▼▲←→]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
