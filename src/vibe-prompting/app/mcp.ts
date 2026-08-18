/** Mirrors the configured evaluation API as an MCP tool without owning API or frontend behavior. */

import { FastMCP } from "@prefecthq/fastmcp-ts/server";

import { getConfiguredModels } from "../server.ts";
import { apiEvaluationSchema, evaluateRequest } from "./api.ts";

export function createMcpServer(): FastMCP {
  const server = new FastMCP({ name: "vibe-prompting" });
  server.tool(
    {
      name: "evaluate",
      title: "Evaluate a model response",
      description:
        "Run string inputs through a configured target model and judge each response against the supplied criteria.",
      input: apiEvaluationSchema,
    },
    evaluateRequest,
  );
  server.resource(
    {
      uri: "config://models",
      title: "Configured models",
      description: "Configured models available for evaluation.",
      mimeType: "application/json",
    },
    async () => JSON.stringify({ models: await getConfiguredModels() }),
  );
  return server;
}

if (import.meta.main) {
  const server = createMcpServer();
  await server.run({
    health: true,
    port: Number(process.env.MCP_PORT ?? 3001),
    transport: "http",
  });
}
