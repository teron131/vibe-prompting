/** Owns constrained Exa MCP adapters shared by LangChain workflows and the general agent runtime. */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createMCPToolStaticFilter, type MCPServer, MCPServerStreamableHttp } from "@openai/agents";

import { EXA_MCP_URL, loadRuntimeConfig } from "../config.ts";

export const EXA_WEB_SEARCH_TOOL = "web_search_exa";

export type ExaTools = {
  close: () => Promise<void>;
  tools: DynamicStructuredTool[];
};

/** Connects the general agent to only Exa web search while keeping all other remote MCP tools hidden. */
export async function connectExaSearch(): Promise<MCPServer> {
  const config = loadRuntimeConfig();
  const server = new MCPServerStreamableHttp({
    cacheToolsList: true,
    name: "exa",
    requestInit: config.exa.apiKey ? { headers: { "x-api-key": config.exa.apiKey } } : undefined,
    toolFilter: createMCPToolStaticFilter({ allowed: [EXA_WEB_SEARCH_TOOL] }),
    url: EXA_MCP_URL,
  });

  try {
    await server.connect();
    const tools = await server.listTools();
    if (!tools.some(({ name }) => name === EXA_WEB_SEARCH_TOOL)) {
      throw new Error(`Exa MCP does not expose: ${EXA_WEB_SEARCH_TOOL}.`);
    }
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

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
