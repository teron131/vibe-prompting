/** Loads a constrained set of Exa tools from its remote MCP server for LangChain workflows. */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import { EXA_MCP_URL, loadRuntimeConfig } from "../config.ts";

export const EXA_WEB_SEARCH_TOOL = "web_search_exa";

export type ExaTools = {
  close: () => Promise<void>;
  tools: DynamicStructuredTool[];
};

/** Connects to Exa over remote HTTP MCP and exposes only explicitly selected tools. */
export async function loadExaTools(
  toolNames: readonly string[] = [EXA_WEB_SEARCH_TOOL],
): Promise<ExaTools> {
  if (!toolNames.length) throw new Error("At least one Exa tool name is required.");

  const config = loadRuntimeConfig();
  const client = new MultiServerMCPClient({
    exa: {
      transport: "http",
      url: EXA_MCP_URL,
      ...(config.exa.apiKey && { headers: { "x-api-key": config.exa.apiKey } }),
    },
  });

  try {
    const tools = await client.getTools("exa");
    const selected = tools.filter((tool) => toolNames.includes(tool.name));
    const missing = toolNames.filter((name) => !selected.some((tool) => tool.name === name));
    if (missing.length) throw new Error(`Exa MCP does not expose: ${missing.join(", ")}.`);

    let closePromise: Promise<void> | undefined;
    return {
      tools: selected,
      close: () => (closePromise ??= client.close()),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
