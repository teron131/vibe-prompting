/** Exposes direct Exa web search as a framework-neutral agent tool with one stable trace identity. */

import { z } from "zod";

import { EXA_WEB_SEARCH_TOOL, searchExaWeb } from "../../clients/exa.ts";
import { loadRuntimeConfig, type RuntimeConfig } from "../../config/index.ts";
import { defineAgentTool } from "./api.ts";

const exaWebSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A semantically rich description of the ideal page; optionally prefix category:company, category:publication, category:news, category:personal site, or category:people.",
    ),
  numResults: z.number().int().min(1).max(100).default(10).describe("Number of results to return."),
});

export function createExaSearchTool(
  readConfig: () => RuntimeConfig = loadRuntimeConfig,
  runtimeSignal?: AbortSignal,
) {
  return defineAgentTool({
    name: EXA_WEB_SEARCH_TOOL,
    title: "Search the web",
    description:
      "Search the public web for current or external information and return relevant page highlights with source URLs.",
    parameters: exaWebSearchSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute(input, { signal }) {
      const requestSignal = runtimeSignal
        ? signal
          ? AbortSignal.any([signal, runtimeSignal])
          : runtimeSignal
        : signal;
      const results = await searchExaWeb(input, requestSignal, readConfig().exa.apiKey);
      return {
        results,
        summary: results.length
          ? `Found ${results.length} web search results.`
          : "No search results found. Try a different query.",
      };
    },
  });
}
