/** Owns constrained Exa MCP connections shared across the supported agent frameworks. */

import { createMCPClient } from "@ai-sdk/mcp";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createMCPToolStaticFilter, type MCPServer, MCPServerStreamableHttp } from "@openai/agents";
import type { ToolSet } from "ai";

import { EXA_MCP_URL, loadRuntimeConfig } from "../config/index.ts";

export const EXA_WEB_SEARCH_TOOL = "web_search_exa";

export type LangChainExaTools = {
  close: () => Promise<void>;
  tools: DynamicStructuredTool[];
};

export type AiSdkExaTools = {
  close: () => Promise<void>;
  tools: ToolSet;
};

/** Connects a Vercel AI SDK target to only Exa web search and returns an explicit lifecycle owner for the remote MCP client. */
export async function connectAiSdkExaSearch(): Promise<AiSdkExaTools> {
  const config = loadRuntimeConfig();
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: EXA_MCP_URL,
      ...(config.exa.apiKey && { headers: { "x-api-key": config.exa.apiKey } }),
    },
  });
  try {
    const definitions = await client.listTools();
    const definition = definitions.tools.find(({ name }) => name === EXA_WEB_SEARCH_TOOL);
    if (!definition) throw new Error(`Exa MCP does not expose: ${EXA_WEB_SEARCH_TOOL}.`);
    const tools = client.toolsFromDefinitions({ ...definitions, tools: [definition] });
    return {
      close: () => client.close(),
      tools: { [EXA_WEB_SEARCH_TOOL]: tools[EXA_WEB_SEARCH_TOOL] as ToolSet[string] },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

/** Connects the OpenAI Agents runtime to only Exa web search while keeping all other remote MCP tools hidden. */
export async function connectOpenAiAgentsExaSearch(): Promise<MCPServer> {
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

/** Connects LangChain to Exa over remote HTTP MCP and exposes only explicitly selected tools. */
export async function connectLangChainExaTools(
  toolNames: readonly string[] = [EXA_WEB_SEARCH_TOOL],
): Promise<LangChainExaTools> {
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
