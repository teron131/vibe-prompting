/** Owns immediate local prompt discovery and debounced hybrid prompt search for client pickers. */

"use client";

import { useEffect, useMemo, useState } from "react";

import type { PromptSearchResponse, PromptSearchResult, PromptSummary } from "@/contracts/prompts";

type PromptSearchState = {
  error: string | null;
  loading: boolean;
  query: string;
  results: PromptSearchResult[];
};

const EMPTY_SERVER_STATE: PromptSearchState = {
  error: null,
  loading: false,
  query: "",
  results: [],
};

export function usePromptSearch({
  enabled,
  limit,
  prompts,
  query,
}: {
  enabled: boolean;
  limit: number;
  prompts: PromptSummary[];
  query: string | null;
}): { error: string | null; loading: boolean; results: PromptSearchResult[] } {
  const normalizedQuery = useMemo(() => (query ?? "").replace(/\s+/g, " ").trim(), [query]);
  const localResults = useMemo(
    () => findLocalPrompts(prompts, normalizedQuery).slice(0, limit),
    [limit, normalizedQuery, prompts],
  );
  const [serverState, setServerState] = useState<PromptSearchState>(EMPTY_SERVER_STATE);

  useEffect(() => {
    if (!enabled || normalizedQuery.length < 2 || normalizedQuery.length > 200) return;

    const controller = new AbortController();
    setServerState({ error: null, loading: true, query: normalizedQuery, results: [] });
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/prompt-search?q=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as PromptSearchResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Prompt search is unavailable.");
        }
        setServerState({
          error: null,
          loading: false,
          query: normalizedQuery,
          results: payload.prompts,
        });
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setServerState({
          error:
            searchError instanceof Error ? searchError.message : "Prompt search is unavailable.",
          loading: false,
          query: normalizedQuery,
          results: [],
        });
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, normalizedQuery]);

  if (!enabled) return { error: null, loading: false, results: [] };
  if (normalizedQuery.length < 2) {
    return { error: null, loading: false, results: localResults };
  }
  if (normalizedQuery.length > 200) {
    return {
      error: "Keep prompt searches to 200 characters or fewer.",
      loading: false,
      results: [],
    };
  }
  if (serverState.query !== normalizedQuery) {
    return { error: null, loading: true, results: [] };
  }
  return {
    error: serverState.error,
    loading: serverState.loading,
    results: (serverState.error ? localResults : serverState.results).slice(0, limit),
  };
}

function findLocalPrompts(prompts: PromptSummary[], query: string): PromptSearchResult[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return prompts
    .filter(({ title }) => !normalizedQuery || title.toLocaleLowerCase().includes(normalizedQuery))
    .map((prompt) => ({ ...prompt, passages: [] }));
}
