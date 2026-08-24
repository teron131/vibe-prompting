/** Composes the shared application capabilities into a FastMCP server for embedded HTTP and explicit local stdio use. */

import { type AuthInfo, FastMCP } from "@prefecthq/fastmcp-ts/server";

import {
  type AgentTool,
  AgentToolkit,
  CriteriaLibraryToolkit,
  EvaluationResultsToolkit,
  EvaluationRunsToolkit,
  PromptLibraryToolkit,
  TargetRunsToolkit,
} from "../agents/tools/index.ts";
import {
  type ApplicationServices,
  type ConfiguredModel,
  getApplicationServices,
  getConfiguredModels,
} from "../server.ts";

export type McpAuthInfo = AuthInfo;

let mcpServerPromise: Promise<FastMCP> | undefined;

/** Builds one MCP capability surface over an existing application-service graph. */
export function createMcpServer(
  services: ApplicationServices,
  loadModels: () => Promise<ConfiguredModel[]> = getConfiguredModels,
): FastMCP {
  const server = new FastMCP({ name: "vibe-prompting" });
  const loadModelReferences = async () =>
    (await loadModels()).map(({ id, label }) => ({ id, label }));
  const toolkits = [
    new PromptLibraryToolkit(services.prompts),
    new CriteriaLibraryToolkit(services.criterion),
    new EvaluationRunsToolkit(services.evaluations, loadModelReferences),
    new EvaluationResultsToolkit(services.evaluationResults),
    new TargetRunsToolkit(services.targetRuns, loadModelReferences),
  ];
  for (const tool of AgentToolkit.compose(toolkits)) registerTool(server, services, tool);
  server.resource(
    {
      uri: "config://models",
      title: "Configured models",
      description: "Configured models available for Target Runs and evaluations.",
      mimeType: "application/json",
    },
    async () => {
      await requireMcpActor(server, services);
      return JSON.stringify({ models: await loadModels() });
    },
  );
  return server;
}

/** Returns the process-shared MCP server used by every Next.js request in this deployment. */
export function getMcpServer(): Promise<FastMCP> {
  if (!mcpServerPromise) {
    mcpServerPromise = getApplicationServices()
      .then((services) => createMcpServer(services))
      .catch((error: unknown) => {
        mcpServerPromise = undefined;
        throw error;
      });
  }
  return mcpServerPromise;
}

function registerTool(server: FastMCP, services: ApplicationServices, tool: AgentTool): void {
  server.tool(
    {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      input: tool.parameters,
      annotations: tool.annotations,
    },
    async (input) => {
      const actorUserId = await requireMcpActor(server, services);
      const output = await tool.execute(input, { actorUserId, chatId: null });
      return absolutizeArtifactLinks(output);
    },
  );
}

async function requireMcpActor(server: FastMCP, services: ApplicationServices): Promise<string> {
  const context = server.getContext();
  const authenticatedActor = context.auth?.claims.actorUserId;
  if (context.http) {
    if (typeof authenticatedActor !== "string") {
      throw new Error("Authenticated MCP actor is required.");
    }
    return authenticatedActor;
  }
  const actorUserId = process.env.MCP_ACTOR_USER_ID?.trim();
  if (!actorUserId) throw new Error("Authenticated MCP actor is required.");
  await services.auth.requireActiveUser(actorUserId);
  return actorUserId;
}

function absolutizeArtifactLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(absolutizeArtifactLinks);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      key === "href" && typeof item === "string" && item.startsWith("/")
        ? publicApplicationUrl(item)
        : absolutizeArtifactLinks(item);
  }
  return result;
}

function publicApplicationUrl(path: string): string {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  return baseUrl ? new URL(path, baseUrl).toString() : path;
}

if (import.meta.main) {
  const server = await getMcpServer();
  await server.run({ transport: "stdio" });
}
