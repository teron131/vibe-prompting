/** Executes general chat with scoped toolkits, steering, attachment projection, and accumulated response usage. */

import type { AgentInputItem } from "@openai/agents";

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ModelConfig } from "../../config/index.ts";
import type { ContextSystem } from "../../context-system/index.ts";
import type {
  Attachment as ChatAttachment,
  ChatReasoningEffort,
  ChatToolId,
} from "../../conversations/schemas.ts";
import type { CriterionLibrary } from "../../criteria/index.ts";
import type { EvaluationResults } from "../../evaluation/results/index.ts";
import type { EvaluationRuns } from "../../evaluation/runs/index.ts";
import type { ScenarioRuns } from "../../scenarios/index.ts";
import type { TargetRuns } from "../../target/runs/index.ts";
import { getConfiguredModelReferences } from "../models.ts";
import {
  AgentToolkit,
  ContextLibraryToolkit,
  createExaSearchTool,
  CriteriaLibraryToolkit,
  EvaluationResultsToolkit,
  EvaluationRunsToolkit,
  ScenarioRunsToolkit,
  TargetRunsToolkit,
} from "../tools/index.ts";
import { type AgentStreamEvent, projectEvent } from "./events.ts";
import { adaptTools, createAgentRuntime } from "./runtime.ts";
import { skillSandbox, toSkillDescriptors } from "./skills.ts";

export {
  CHAT_TOOL_IDS,
  type ChatToolId,
  type ChatReasoningEffort,
  type Attachment as ChatAttachment,
} from "../../conversations/schemas.ts";

type ChatInputContent = Exclude<
  Extract<AgentInputItem, { role: "user" }>["content"],
  string
>[number];

export type ChatConversationMessage = {
  role: "assistant" | "user";
  text: string;
};

export type ChatRunInput = {
  modelContext?: ModelContext;
  actorUserId: string;
  chatId: string;
  instruction: string;
  history: ChatConversationMessage[];
  attachments: ChatAttachment[];
  modelId: string;
  reasoningEffort: ChatReasoningEffort;
  enabledTools: ChatToolId[];
  contexts: ContextSystem;
  criterion: CriterionLibrary;
  evaluations: EvaluationRuns;
  evaluationResults: EvaluationResults;
  targetRuns: TargetRuns;
  scenarios: ScenarioRuns;
  signal?: AbortSignal;
  steering?: ChatSteering;
};

export type ChatSteering = {
  connect(handler: (instruction: string) => boolean): () => void;
  drain(): string[];
  retry(): void;
  close(): boolean;
};

export type ChatRunResult = {
  message: string;
  model: ModelConfig;
  skillRevisions?: Array<{ contextId: string; revisionId: string; name: string }>;
  telemetry: {
    durationMs: number;
    estimatedCostUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    requests: number;
    totalTokens: number | null;
  };
};

/** Runs a detached chat stream, preserving steering retries and tool event projections. */
export async function streamChatRun(
  input: ChatRunInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ChatRunResult> {
  const modelContext = input.modelContext ?? standaloneModelContext;
  const startedAt = performance.now();
  onEvent({ type: "response-start", startedAt: new Date().toISOString() });
  const enabled = new Set(input.enabledTools);
  const toolkits: AgentToolkit[] = [];
  const contextToolsEnabled = enabled.has("context-library");
  const evaluationsEnabled = enabled.has("evaluations");
  if (contextToolsEnabled) {
    toolkits.push(new ContextLibraryToolkit(input.contexts));
  }
  if (evaluationsEnabled)
    toolkits.push(
      new CriteriaLibraryToolkit(input.criterion),
      new EvaluationRunsToolkit(input.evaluations, input.evaluationResults, () =>
        getConfiguredModelReferences(modelContext),
      ),
      new EvaluationResultsToolkit(input.evaluationResults),
      new ScenarioRunsToolkit(input.scenarios, () => getConfiguredModelReferences(modelContext)),
      new TargetRunsToolkit(input.targetRuns, () => getConfiguredModelReferences(modelContext)),
    );
  const toolDefinitions = AgentToolkit.compose(toolkits);
  if (enabled.has("web-search"))
    toolDefinitions.push(createExaSearchTool(modelContext.readConfig, modelContext.signal));

  input.signal?.throwIfAborted();
  const skillRecords = enabled.has("skills") ? await input.contexts.listSkills() : [];
  const availableSkills = toSkillDescriptors(skillRecords);
  const runtime = createAgentRuntime(
    input.modelId,
    adaptTools(toolDefinitions, {
      actorUserId: input.actorUserId,
      chatId: input.chatId,
      signal: input.signal,
    }),
    input.reasoningEffort,
    modelContext,
    { skills: availableSkills },
  );
  const costEstimate = modelContext.pricing.estimate(runtime.model.id);
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 };
  let runInput = formatConversation(input);
  const toolNames = new Map<string, string>();
  while (true) {
    const run = await runtime.runner.run(runtime.agent, runInput, {
      signal: input.signal,
      stream: true,
      ...(availableSkills.length && { sandbox: skillSandbox() }),
    });
    const disconnectSteering = input.steering?.connect((instruction) => {
      try {
        run.state.addInput(instruction);
        return true;
      } catch {
        return false;
      }
    });
    try {
      onEvent({ type: "reasoning-start" });
      for await (const event of run) {
        for (const item of projectEvent(event, toolNames)) onEvent(item);
        input.steering?.retry();
      }
      await run.completed;
    } finally {
      disconnectSteering?.();
    }
    usage.requests += run.state.usage.requests;
    usage.inputTokens += run.state.usage.inputTokens;
    usage.outputTokens += run.state.usage.outputTokens;
    usage.totalTokens += run.state.usage.totalTokens;
    if (run.error) throw run.error;
    if (typeof run.finalOutput !== "string") throw new Error("The model did not return text.");
    const queuedSteering = input.steering?.drain() ?? [];
    if (queuedSteering.length) {
      onEvent({ type: "response-reset" });
      runInput = [
        ...run.history,
        ...queuedSteering.map((content) => ({ content, role: "user" as const })),
      ];
      continue;
    }
    if (!input.steering || input.steering.close()) {
      const hasReportedTokens = usage.totalTokens > 0;
      const durationMs = Math.max(0, performance.now() - startedAt);
      onEvent({ type: "response-complete", durationMs });
      return {
        message: run.finalOutput,
        model: runtime.model,
        skillRevisions: skillRecords.map((record) => ({
          contextId: record.id,
          revisionId: record.revisionId,
          name: record.skill.name,
        })),
        telemetry: {
          durationMs,
          estimatedCostUsd: await costEstimate.calculate(usage),
          inputTokens: hasReportedTokens ? usage.inputTokens : null,
          outputTokens: hasReportedTokens ? usage.outputTokens : null,
          requests: usage.requests,
          totalTokens: hasReportedTokens ? usage.totalTokens : null,
        },
      };
    }
  }
}

function formatConversation(input: ChatRunInput): AgentInputItem[] {
  const transcript = input.history
    .map(({ role, text }) => `${role === "user" ? "User" : "Assistant"}: ${text}`)
    .join("\n\n");
  const text = transcript
    ? `Conversation so far:\n\n${transcript}\n\nUser: ${input.instruction}`
    : input.instruction;
  const content: ChatInputContent[] = [{ type: "input_text", text }];
  for (const attachment of input.attachments) content.push(projectAttachment(attachment));
  return [{ content, role: "user" }];
}

function projectAttachment(attachment: ChatAttachment): ChatInputContent {
  if (attachment.mediaType.startsWith("image/"))
    return { type: "input_image", image: attachment.dataUrl, detail: "auto" };
  if (isTextAttachment(attachment.mediaType))
    return {
      type: "input_text",
      text: `Attached file ${attachment.name}:\n\n${decodeDataUrl(attachment.dataUrl)}`,
    };
  return { type: "input_file", file: attachment.dataUrl, filename: attachment.name };
}

function isTextAttachment(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") ||
    ["application/json", "application/javascript", "application/xml"].includes(mediaType)
  );
}

function decodeDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Attached text file has an invalid data URL.");
  const metadata = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  return metadata.endsWith(";base64")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
}
