/** Owns immediate local context discovery and debounced hybrid context search for client pickers. */

"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  ContextSearchResponse,
  ContextSearchResult,
  ContextSummary,
} from "@/contracts/contexts";
import { requestJson } from "@/shared/api";

type ContextSearchState = {
  error: string | null;
  loading: boolean;
  query: string;
  results: ContextSearchResult[];
};

const EMPTY_SERVER_STATE: ContextSearchState = {
  error: null,
  loading: false,
  query: "",
  results: [],
};

export function useContextSearch({
  enabled,
  limit,
  contexts,
  query,
}: {
  enabled: boolean;
  limit: number;
  contexts: ContextSummary[];
  query: string | null;
}): { error: string | null; loading: boolean; results: ContextSearchResult[] } {
  const normalizedQuery = useMemo(() => (query ?? "").replace(/\s+/g, " ").trim(), [query]);
  const localResults = useMemo(
    () => findLocalContexts(contexts, normalizedQuery).slice(0, limit),
    [limit, normalizedQuery, contexts],
  );
  const [serverState, setServerState] = useState<ContextSearchState>(EMPTY_SERVER_STATE);

  useEffect(() => {
    if (!enabled || normalizedQuery.length < 2 || normalizedQuery.length > 200) return;

    const controller = new AbortController();
    setServerState({ error: null, loading: true, query: normalizedQuery, results: [] });
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await requestJson<ContextSearchResponse>(
          `/api/context-search?q=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal },
          "Context search is unavailable.",
        );
        setServerState({
          error: null,
          loading: false,
          query: normalizedQuery,
          results: payload.contexts,
        });
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setServerState({
          error:
            searchError instanceof Error ? searchError.message : "Context search is unavailable.",
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
      error: "Keep context searches to 200 characters or fewer.",
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

function findLocalContexts(contexts: ContextSummary[], query: string): ContextSearchResult[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return contexts
    .filter(({ title }) => !normalizedQuery || title.toLocaleLowerCase().includes(normalizedQuery))
    .map((context) => ({ ...context, passages: [] }));
}
