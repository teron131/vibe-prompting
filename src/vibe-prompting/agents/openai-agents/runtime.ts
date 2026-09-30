/** Constructs the OpenAI Agents SDK runner and adapts framework-neutral tools without owning chat or editing workflows. */

import { Agent as OpenAIAgent, Runner, tool, type Tool } from "@openai/agents";
import { SandboxAgent, shell, type SkillDescriptor, skills } from "@openai/agents/sandbox";

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ModelConfig } from "../../config/index.ts";
import type { ChatReasoningEffort } from "../../conversations/schemas.ts";
import type { AgentTool, AgentToolExecutionContext } from "../tools/api.ts";
import { createModel } from "./model.ts";
import { SKILL_WORKSPACE_INSTRUCTIONS } from "./skills.ts";

const AGENT_INSTRUCTIONS = [
  "You are the Vibe Prompting assistant, a general-purpose collaborator for creating, running, inspecting, and evaluating contexts.",
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
  options: { skills?: SkillDescriptor[]; instructions?: string; maxOutputTokens?: number } = {},
): AgentRuntime {
  const { config, provider } = createModel(modelId, modelContext);
  const usesResponses = config.id.startsWith("gpt-");

  const Agent = options.skills?.length ? SandboxAgent : OpenAIAgent;
  return {
    model: config,
    agent: new Agent({
      instructions: options.instructions ?? AGENT_INSTRUCTIONS,
      ...(options.skills?.length && {
        baseInstructions: SKILL_WORKSPACE_INSTRUCTIONS,
        capabilities: [shell(), skills({ skills: options.skills })],
      }),
      model: config.id,
      modelSettings: {
        maxTokens: options.maxOutputTokens,
        ...(config.platform === "gemini"
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
            }),
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
