/** Composes prompt editing, general chat, safe stream projection, and framework-adapted agent tools. */

import {
  type AgentInputItem,
  Agent as OpenAIAgent,
  Runner,
  type RunStreamEvent,
  tool,
  type Tool,
} from "@openai/agents";

import { resolveModelIdentities } from "../../clients/llm/models-dev.ts";
import { startModelCostEstimate } from "../../clients/llm/pricing.ts";
import { loadRuntimeConfig, type ModelConfig } from "../../config/index.ts";
import type { CriterionLibrary } from "../../evaluation/criteria.ts";
import type { EvaluationResults } from "../../evaluation/results/index.ts";
import type { EvaluationRuns } from "../../evaluation/runs/index.ts";
import type { PromptSystem } from "../../prompt-system/index.ts";
import type { TargetRuns } from "../../target/runs/index.ts";
import type { ScenarioRuns } from "../../target/scenarios/index.ts";
import {
  type AgentTool,
  type AgentToolExecutionContext,
  AgentToolkit,
  createExaSearchTool,
  createPromptWorkspace,
  createScopedFsTools,
  CriteriaLibraryToolkit,
  EvaluationResultsToolkit,
  EvaluationRunsToolkit,
  PromptLibraryToolkit,
  ScenarioRunsToolkit,
  TargetRunsToolkit,
} from "../tools/index.ts";
import { AGENT_INSTRUCTIONS } from "./instructions.ts";
import { createModel } from "./model.ts";
import { readChatCompletionsReasoning } from "./reasoning.ts";

export type AgentRuntime = {
  model: ModelConfig;
  agent: OpenAIAgent;
  runner: Runner;
};

export type AgentStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; delta: string }
  | { type: "response-reset" }
  | { type: "response-start"; startedAt: string }
  | { type: "response-complete"; durationMs: number }
  | {
      type: "tool";
      callId: string;
      name: string;
      state: "completed" | "running";
      input?: unknown;
      output?: unknown;
      summary?: string;
    }
  | { type: "prompt-revision"; promptId: string; revisionId: string }
  | { type: "reasoning"; summary: string };

export type PromptEdit = {
  message: string;
  markdown: string;
  model: ModelConfig;
};

export type PromptEditInput = {
  markdown: string;
  instruction: string;
  modelId: string;
  signal?: AbortSignal;
};

export const CHAT_TOOL_IDS = ["prompt-library", "evaluations", "web-search"] as const;

export type ChatToolId = (typeof CHAT_TOOL_IDS)[number];

export type ChatReasoningEffort = "low" | "medium" | "high" | "xhigh";

type ChatInputContent = Exclude<
  Extract<AgentInputItem, { role: "user" }>["content"],
  string
>[number];

export type ChatAttachment = {
  name: string;
  mediaType: string;
  size: number;
  dataUrl: string;
};

export type ChatConversationMessage = {
  role: "assistant" | "user";
  text: string;
};

export type ChatRunInput = {
  actorUserId: string;
  chatId: string;
  instruction: string;
  history: ChatConversationMessage[];
  attachments: ChatAttachment[];
  modelId: string;
  reasoningEffort: ChatReasoningEffort;
  enabledTools: ChatToolId[];
  prompts: PromptSystem;
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
  telemetry: {
    durationMs: number;
    estimatedCostUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    requests: number;
    totalTokens: number | null;
  };
};

/** Builds one agent runner with provider-specific reasoning settings and scoped tools. */
export function createAgentRuntime(
  modelId: string,
  tools: Tool[] = [],
  reasoningEffort: ChatReasoningEffort = "medium",
): AgentRuntime {
  const { config, provider } = createModel(modelId);
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
function adaptTools(
  definitions: readonly AgentTool[],
  executionContext: AgentToolExecutionContext = {},
): Tool[] {
  return definitions.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: (input, _context, details) =>
        definition.execute(input, { ...executionContext, signal: details?.signal }),
    }),
  );
}

/** Runs a detached chat stream, preserving steering retries and tool event projections. */
export async function streamChatRun(
  input: ChatRunInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ChatRunResult> {
  const startedAt = performance.now();
  onEvent({ type: "response-start", startedAt: new Date().toISOString() });
  const enabled = new Set(input.enabledTools);
  const toolkits: AgentToolkit[] = [];
  const promptToolsEnabled = enabled.has("prompt-library");
  const evaluationsEnabled = enabled.has("evaluations");
  if (promptToolsEnabled) {
    toolkits.push(new PromptLibraryToolkit(input.prompts));
  }
  if (evaluationsEnabled)
    toolkits.push(
      new CriteriaLibraryToolkit(input.criterion),
      new EvaluationRunsToolkit(input.evaluations, getEvaluationModelReferences),
      new EvaluationResultsToolkit(input.evaluationResults),
      new ScenarioRunsToolkit(input.scenarios, getEvaluationModelReferences),
      new TargetRunsToolkit(input.targetRuns, getEvaluationModelReferences),
    );
  const toolDefinitions = AgentToolkit.compose(toolkits);
  if (enabled.has("web-search")) toolDefinitions.push(createExaSearchTool());

  if (input.signal?.aborted) throw abortReason(input.signal);
  const runtime = createAgentRuntime(
    input.modelId,
    adaptTools(toolDefinitions, { actorUserId: input.actorUserId, chatId: input.chatId }),
    input.reasoningEffort,
  );
  const costEstimate = startModelCostEstimate(runtime.model.id);
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 };
  let runInput = formatConversation(input);
  const toolNames = new Map<string, string>();
  while (true) {
    const run = await runtime.runner.run(runtime.agent, runInput, {
      signal: input.signal,
      stream: true,
    });
    const disconnectSteering = input.steering?.connect((instruction) => {
      try {
        run.state.addInput(instruction);
        return true;
      } catch {
        return false;
      }
    });
    onEvent({ type: "reasoning-start" });
    for await (const event of run) {
      for (const item of projectEvent(event, toolNames)) onEvent(item);
      input.steering?.retry();
    }
    try {
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

/** Loads canonical model labels for the evaluation tool without exposing provider metadata. */
async function getEvaluationModelReferences() {
  const { models } = loadRuntimeConfig();
  const identities = await resolveModelIdentities(models.map(({ id }) => id));
  return models.map(({ id }, index) => ({ id, label: identities[index]?.label ?? id }));
}

/** Runs a prompt-edit request while discarding stream events for the non-streaming facade. */
export async function editPrompt(input: PromptEditInput): Promise<PromptEdit> {
  return streamPromptEdit(input, () => undefined);
}

/** Runs a prompt-edit stream and always disposes its temporary workspace. */
export async function streamPromptEdit(
  input: PromptEditInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<PromptEdit> {
  const workspace = await createPromptWorkspace(input.markdown);

  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    const runtime = createAgentRuntime(
      input.modelId,
      adaptTools([...createScopedFsTools(workspace), createExaSearchTool()]),
    );
    const run = await runtime.runner.run(runtime.agent, input.instruction, {
      signal: input.signal,
      stream: true,
    });
    const toolNames = new Map<string, string>();
    for await (const event of run) {
      for (const item of projectEvent(event, toolNames)) onEvent(item);
    }
    await run.completed;
    if (run.error) throw run.error;
    if (typeof run.finalOutput !== "string") {
      throw new Error("The model did not return text.");
    }
    return {
      message: run.finalOutput,
      markdown: await workspace.read(),
      model: runtime.model,
    };
  } finally {
    await workspace.dispose();
  }
}

/** Projects provider stream events into the small event contract consumed by the frontend. */
function projectEvent(event: RunStreamEvent, toolNames: Map<string, string>): AgentStreamEvent[] {
  if (event.type === "raw_model_stream_event") {
    if (event.data.type === "output_text_delta") {
      return event.data.delta ? [{ type: "text-delta", delta: event.data.delta }] : [];
    }
    if (event.data.type !== "model" || !isRecord(event.data.event)) return [];
    const reasoningDelta =
      event.data.event.type === "response.reasoning_summary_text.delta" &&
      typeof event.data.event.delta === "string"
        ? event.data.event.delta
        : readChatCompletionsReasoning(event.data.event)?.text;
    return reasoningDelta ? [{ type: "reasoning-delta", delta: reasoningDelta }] : [];
  }
  if (event.type !== "run_item_stream_event") {
    return [];
  }
  if (event.name === "reasoning_item_created") {
    return [
      {
        type: "reasoning",
        summary: getReasoningSummary(event.item.rawItem) ?? "Thinking through the request.",
      },
    ];
  }
  if (event.name === "tool_called") {
    const identity = getToolIdentity(event.item.rawItem);
    if (!identity) return [];
    toolNames.set(identity.callId, identity.name);
    return [
      {
        type: "tool",
        callId: identity.callId,
        name: identity.name,
        state: "running",
        input: getToolInput(event.item.rawItem),
      },
    ];
  }
  if (event.name === "tool_output") {
    const identity = getToolIdentity(event.item.rawItem);
    const callId =
      identity?.callId ??
      ("callId" in event.item && typeof event.item.callId === "string"
        ? event.item.callId
        : undefined);
    if (!callId) return [];
    const name = identity?.name ?? toolNames.get(callId) ?? "tool";
    const output = normalizeEventValue("output" in event.item ? event.item.output : undefined);
    const toolEvent: AgentStreamEvent = {
      type: "tool",
      callId,
      name,
      state: "completed",
      output,
      summary: summarizeTool(name, output),
    };
    const revisionEvent = projectPromptRevision(name, output);
    return revisionEvent ? [toolEvent, revisionEvent] : [toolEvent];
  }
  return [];
}

function projectPromptRevision(
  toolName: string,
  output: unknown,
): Extract<AgentStreamEvent, { type: "prompt-revision" }> | undefined {
  if (toolName !== "edit_prompt" || !isRecord(output) || !isRecord(output.prompt)) return undefined;
  const { id, revisionId } = output.prompt;
  if (typeof id !== "string" || typeof revisionId !== "string") return undefined;
  return { type: "prompt-revision", promptId: id, revisionId };
}

function getReasoningSummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const content =
    Array.isArray(value.rawContent) && value.rawContent.length > 0
      ? value.rawContent
      : Array.isArray(value.content)
        ? value.content
        : [];
  const summary = content
    .map((entry) => {
      if (!isRecord(entry) || (entry.type !== "reasoning_text" && entry.type !== "input_text"))
        return "";
      return typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return summary || undefined;
}

function getToolInput(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const item = value as {
    arguments?: unknown;
    input?: unknown;
    providerData?: { arguments?: unknown; input?: unknown };
  };
  const raw =
    item.arguments ?? item.input ?? item.providerData?.arguments ?? item.providerData?.input;
  if (typeof raw !== "string") return normalizeEventValue(raw);
  try {
    return normalizeEventValue(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function normalizeEventValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getToolIdentity(value: unknown): { callId: string; name: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as { callId?: unknown; id?: unknown; name?: unknown };
  const callId =
    typeof item.callId === "string"
      ? item.callId
      : typeof item.id === "string"
        ? item.id
        : undefined;
  return callId && typeof item.name === "string" ? { callId, name: item.name } : undefined;
}

function summarizeTool(name: string, output: unknown): string {
  if (isRecord(output) && typeof output.summary === "string" && output.summary.trim()) {
    return output.summary;
  }
  if (name === "list_prompts") return "Listed saved prompts.";
  if (name === "read_prompt") return "Read the current prompt.";
  if (name === "search_prompts") return "Searched saved prompts.";
  if (name === "list_criteria_library") return "Listed saved criteria.";
  if (name === "preview_evaluation_batch") return "Previewed an evaluation batch.";
  if (name === "list_evaluation_runs") return "Listed evaluation runs.";
  if (name === "search_evaluations") return "Searched persisted evaluation cases.";
  if (name === "get_evaluation_analytics") return "Analyzed persisted evaluation data.";
  if (name === "web_search_exa") return "Completed web research.";
  if (typeof output === "string" && output.length <= 120) return output;
  return "Completed.";
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

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The run was stopped.", "AbortError");
}
