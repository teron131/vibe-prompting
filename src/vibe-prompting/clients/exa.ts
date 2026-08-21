/** Owns Exa provider primitives for direct search and usage-owned MCP adaptation without constructing an agent runtime. */

import { z } from "zod";

import { loadRuntimeConfig } from "../config/index.ts";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_SEARCH_TIMEOUT_MS = 30_000;
const DEFAULT_RESULT_COUNT = 10;
const CATEGORY_PATTERN = /\bcategory:(company|publication|news|personal\s*site|people)\b/iu;

export const EXA_WEB_SEARCH_TOOL = "web_search_exa";

const exaSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  numResults: z.number().int().min(1).max(100).default(DEFAULT_RESULT_COUNT),
});

const optionalProviderText = z.string().nullish();
const exaSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      author: optionalProviderText,
      highlights: z.array(z.string()).nullish(),
      publishedDate: optionalProviderText,
      text: optionalProviderText,
      title: optionalProviderText,
      url: z.string().min(1),
    }),
  ),
});

export type ExaWebSearchInput = z.input<typeof exaSearchInputSchema>;

export type ExaWebSearchResult = {
  author?: string;
  highlights?: string[];
  publishedDate?: string;
  text?: string;
  title?: string;
  url: string;
};

type ExaMcpConnection = {
  headers?: Record<string, string>;
  url: string;
};

/** Resolves transport-neutral Exa MCP connection data for usages that must reproduce an MCP-backed target. */
export function getExaMcpConnection(apiKey = loadRuntimeConfig().exa.apiKey): ExaMcpConnection {
  return {
    url: EXA_MCP_URL,
    ...(apiKey && { headers: { "x-api-key": apiKey } }),
  };
}

/** Searches Exa directly and returns only the stable result fields consumed by agent tools. */
export async function searchExaWeb(
  input: ExaWebSearchInput,
  signal?: AbortSignal,
): Promise<ExaWebSearchResult[]> {
  const apiKey = loadRuntimeConfig().exa.apiKey;
  if (!apiKey) throw new Error("EXA_API_KEY is required for web search.");

  const { query, numResults } = exaSearchInputSchema.parse(input);
  const categoryMatch = query.match(CATEGORY_PATTERN);
  const category = categoryMatch?.[1]?.toLocaleLowerCase().replace(/\s+/gu, " ");
  const cleanedQuery = categoryMatch
    ? query.replace(categoryMatch[0], "").replace(/\s+/gu, " ").trim()
    : query;
  if (!cleanedQuery)
    throw new Error("Exa search query must contain text beyond its category filter.");

  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(EXA_SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(EXA_SEARCH_TIMEOUT_MS);
  const response = await fetch(EXA_SEARCH_URL, {
    body: JSON.stringify({
      query: cleanedQuery,
      type: "auto",
      numResults,
      ...(category && { category }),
      contents: { highlights: true },
    }),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    method: "POST",
    signal: requestSignal,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(
      `Exa search failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
    );
  }

  let providerResponse: z.infer<typeof exaSearchResponseSchema>;
  try {
    providerResponse = exaSearchResponseSchema.parse(await response.json());
  } catch (error) {
    throw new Error("Exa returned an invalid search response.", { cause: error });
  }
  return providerResponse.results.map((result) => ({
    ...(result.author && { author: result.author }),
    ...(result.highlights?.length && { highlights: result.highlights }),
    ...(result.publishedDate && { publishedDate: result.publishedDate }),
    ...(result.text && { text: result.text }),
    ...(result.title && { title: result.title }),
    url: result.url,
  }));
}
