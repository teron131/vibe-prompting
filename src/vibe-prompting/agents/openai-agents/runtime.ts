/** Constructs the OpenAI Agents SDK runner and adapts framework-neutral tools without owning chat or editing workflows. */

import { Agent as OpenAIAgent, Runner, tool, type Tool } from "@openai/agents";

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ModelConfig } from "../../config/index.ts";
import type { ChatReasoningEffort } from "../../conversations/schemas.ts";
import type { AgentTool, AgentToolExecutionContext } from "../tools/api.ts";
import { createModel } from "./model.ts";

const AGENT_INSTRUCTIONS = [
  "You are the Vibe Prompting assistant, a general-purpose collaborator for creating, running, inspecting, and evaluating prompts.",
  "Answer ordinary questions directly. Use available tools where they materially improve the result, and represent returned records, statuses, and provenance accurately.",
].join("\n");

export type AgentRuntime = {
  model: ModelConfig;
  agent: OpenAIAgent;
  runner: Runner;
};

/** Builds one agent runner with provider-specific reasoning settings and scoped tools. */
export function createAgentRuntime(
  modelId: string,
  tools: Tool[] = [],
  reasoningEffort: ChatReasoningEffort = "medium",
  modelContext: ModelContext = standaloneModelContext,
): AgentRuntime {
  const { config, provider } = createModel(modelId, modelContext);
  const usesResponses = config.id.startsWith("gpt-");

  return {
    model: config,
    agent: new OpenAIAgent({
      instructions: AGENT_INSTRUCTIONS,
      model: config.id,
      modelSettings:
        config.platform === "gemini"
          ? {
              providerData: {
                extra_body: {
                  google: {
                    thinking_config: {
                      include_thoughts: true,
                      thinking_level: reasoningEffort === "xhigh" ? "high" : reasoningEffort,
                    },
                  },
                },
              },
            }
          : {
              reasoning: {
                effort: reasoningEffort,
                summary: usesResponses ? "detailed" : "auto",
              },
            },
      name: "Vibe Prompting",
      tools,
    }),
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: true,
    }),
  };
}

/** Translates framework-neutral definitions into OpenAI Agents SDK function tools at runtime composition. */
export function adaptTools(
  definitions: readonly AgentTool[],
  executionContext: AgentToolExecutionContext = {},
): Tool[] {
  return definitions.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: (input, _context, details) =>
        definition.execute(input, {
          ...executionContext,
          signal:
            executionContext.signal && details?.signal
              ? AbortSignal.any([executionContext.signal, details.signal])
              : (executionContext.signal ?? details?.signal),
        }),
    }),
  );
}
