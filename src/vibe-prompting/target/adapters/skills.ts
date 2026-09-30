/** Runs pinned skills through SandboxAgent and projects native reads, text, and usage into durable Target runs and evaluation calls. */

import type { AgentInputItem } from "@openai/agents";
import type { ModelMessage } from "ai";

import { projectEvent } from "../../agents/openai-agents/events.ts";
import { adaptTools, createAgentRuntime } from "../../agents/openai-agents/runtime.ts";
import { skillSandbox } from "../../agents/openai-agents/skills.ts";
import { createExaSearchTool } from "../../agents/tools/exa.ts";
import type { ModelContext } from "../../clients/llm/context.ts";
import type { PinnedTargetDefinition, TargetActivityPart } from "../schemas.ts";
import type { AiSdkTargetRuntime } from "./ai-sdk.ts";

/** Creates a fresh skill workspace per call, retaining the exact revision across scenario continuations and evaluations. */
export function createSkillTargetRuntime(
  definition: PinnedTargetDefinition,
  models: ModelContext,
): AiSdkTargetRuntime & { close(): Promise<void> } {
  const skill = definition.skill;
  if (!skill) throw new Error("A skill Target requires a pinned skill revision.");
  const runtime = createAgentRuntime(
    definition.targetModel,
    adaptTools(
      definition.profile.configuration.tools?.includes("web-search")
        ? [createExaSearchTool(models.readConfig, models.signal)]
        : [],
    ),
    definition.reasoningEffort ?? "medium",
    models,
    {
      skills: [{ name: skill.name, description: skill.description, content: skill.markdown }],
      instructions: definition.effectiveInstructions,
      maxOutputTokens: definition.profile.configuration.maxOutputTokens,
    },
  );
  const controller = new AbortController();
  const pending = new Set<Promise<Awaited<ReturnType<AiSdkTargetRuntime["run"]>>>>();
  const execute: AiSdkTargetRuntime["run"] = async ({ messages, onEvent, signal }) => {
    const result = await runtime.runner.run(runtime.agent, toAgentInput(messages), {
      signal: AbortSignal.any([controller.signal, models.signal, ...(signal ? [signal] : [])]),
      stream: true,
      maxTurns: definition.profile.configuration.maxSteps ?? 10,
      sandbox: skillSandbox(),
    });
    const activity: TargetActivityPart[] = [];
    const toolNames = new Map<string, string>();
    for await (const event of result) {
      for (const projected of projectEvent(event, toolNames)) {
        if (
          projected.type === "text-delta" ||
          projected.type === "reasoning-delta" ||
          projected.type === "reasoning-start"
        ) {
          onEvent?.(projected);
        } else if (projected.type === "tool" || projected.type === "reasoning") {
          const existing =
            projected.type === "tool"
              ? activity.findIndex(
                  (part) => part.type === "tool" && part.callId === projected.callId,
                )
              : -1;
          const part =
            projected.type === "tool" && existing >= 0
              ? ({ ...activity[existing], ...projected } as TargetActivityPart)
              : projected;
          if (existing >= 0) activity[existing] = part;
          else activity.push(part);
          onEvent?.(part);
        }
      }
    }
    await result.completed;
    if (result.error) throw result.error;
    if (typeof result.finalOutput !== "string")
      throw new Error("The skill Target did not return text.");
    return {
      activity,
      output: result.finalOutput,
      responseMessages: [{ role: "assistant", content: result.finalOutput }],
      usage: {
        inputTokens: result.state.usage.inputTokens,
        outputTokens: result.state.usage.outputTokens,
        totalTokens: result.state.usage.totalTokens,
      },
    };
  };
  const run: AiSdkTargetRuntime["run"] = (input) => {
    const execution = execute(input);
    pending.add(execution);
    void execution.then(
      () => pending.delete(execution),
      () => pending.delete(execution),
    );
    return execution;
  };
  return {
    run,
    async close() {
      controller.abort(new DOMException("The skill Target runtime closed.", "AbortError"));
      await Promise.allSettled(pending);
    },
    target: {
      model: definition.targetModel,
      async invoke(input) {
        const result = await run({
          messages: [{ role: "user", content: input }],
          signal: models.signal,
        });
        return result.output;
      },
    },
  };
}

function toAgentInput(messages: ModelMessage[]): AgentInputItem[] {
  return messages.flatMap((message): AgentInputItem[] => {
    if (message.role === "tool") return [];
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    if (message.role === "assistant")
      return [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      ];
    return [{ role: message.role, content: text }];
  });
}
