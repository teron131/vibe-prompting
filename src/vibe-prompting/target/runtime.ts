/** Opens the AI SDK model and optional Exa tools for a resolved Target definition and owns their cleanup. */

import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";

import { createModel, createReasoningProviderOptions } from "../agents/ai-sdk/model.ts";
import { EXA_WEB_SEARCH_TOOL, getExaMcpConnection } from "../clients/exa.ts";
import { type ModelContext, standaloneModelContext } from "../clients/llm/context.ts";
import { type AiSdkTargetRuntime, createAiSdkTargetRuntime } from "./adapters/ai-sdk.ts";
import type { PinnedTargetDefinition, Target, TargetProfile } from "./schemas.ts";

export type PinnedTarget = {
  close(): Promise<void>;
  effectiveInstructionsHash: string;
  profile: TargetProfile;
  runtime: AiSdkTargetRuntime;
  target: Target<string, string>;
};

type ConnectedExaTools = {
  close(): Promise<void>;
  tools: ToolSet;
};

/** Opens one pinned runtime and releases connected tools if subsequent runtime initialization fails. */
export async function openTargetRuntime(
  definition: PinnedTargetDefinition,
  models: ModelContext = standaloneModelContext,
): Promise<PinnedTarget> {
  const model = createModel(definition.targetModel, models);
  const exa = definition.profile.configuration.tools?.includes("web-search")
    ? await connectAiSdkExaSearch(models)
    : undefined;
  try {
    models.signal.throwIfAborted();
    const runtime = createAiSdkTargetRuntime({
      configuration: definition.profile.configuration,
      instructions: definition.effectiveInstructions,
      model,
      modelId: definition.targetModel,
      profileId: definition.profile.id,
      providerOptions: definition.reasoningEffort
        ? createReasoningProviderOptions(definition.targetModel, definition.reasoningEffort, models)
        : undefined,
      tools: exa?.tools,
    });
    return {
      close: () => exa?.close() ?? Promise.resolve(),
      effectiveInstructionsHash: definition.effectiveInstructionsHash,
      profile: definition.profile,
      runtime,
      target: runtime.target,
    };
  } catch (error) {
    await exa?.close();
    throw error;
  }
}

/** Selects the supported Exa MCP tool and closes the connection if discovery or adaptation fails. */
async function connectAiSdkExaSearch(models: ModelContext): Promise<ConnectedExaTools> {
  const connection = getExaMcpConnection(models.readConfig().exa.apiKey);
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: connection.url,
      ...(connection.headers && { headers: connection.headers }),
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
