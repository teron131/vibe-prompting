/** Composes prompt editing, general chat, safe stream projection, scoped tools, and idempotent cleanup. */

import {
  type AgentInputItem,
  type MCPServer,
  Agent as OpenAIAgent,
  Runner,
  type RunStreamEvent,
  type Tool,
} from "@openai/agents";

import { connectOpenAiAgentsExaSearch } from "../clients/exa.ts";
import { resolveModelIdentities } from "../clients/llm/models-dev.ts";
import { createModel } from "../clients/llm/openai-agents.ts";
import { readChatCompletionsReasoning } from "../clients/llm/reasoning.ts";
import { loadRuntimeConfig, type ModelConfig } from "../config/index.ts";
import type { EvaluationResults } from "../evaluation/results/index.ts";
import type { EvaluationRuns } from "../evaluation/runs/index.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import { AGENT_INSTRUCTIONS } from "./instructions.ts";
import { createEvaluationDataTools } from "./tools/evaluation-search.ts";
import { createEvaluationTool } from "./tools/evaluation.ts";
import { createPromptLibraryTools } from "./tools/prompt-library.ts";
import { createPromptWorkspace, createScopedFsTools } from "./tools/scoped-fs.ts";

export type AgentRuntime = {
  agent: OpenAIAgent;
  model: ModelConfig;
  runner: Runner;
};

export type AgentStreamEvent =
  | { delta: string; type: "text-delta" }
  | { type: "reasoning-start" }
  | { delta: string; type: "reasoning-delta" }
  | { type: "response-reset" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "running";
      summary?: string;
      type: "tool";
    }
  | { promptId: string; revisionId: string; type: "prompt-revision" }
  | { summary: string; type: "reasoning" };

export type PromptEdit = {
  markdown: string;
  message: string;
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

export type ChatReasoningEffort = "high" | "low" | "medium" | "xhigh";

type ChatInputContent = Exclude<
  Extract<AgentInputItem, { role: "user" }>["content"],
  string
>[number];

export type ChatAttachment = {
  dataUrl: string;
  mediaType: string;
  name: string;
  size: number;
};

export type ChatConversationMessage = {
  role: "assistant" | "user";
  text: string;
};

export type ChatRunInput = {
  attachments: ChatAttachment[];
  chatId: string;
  enabledTools: ChatToolId[];
  evaluations: EvaluationRuns;
  evaluationResults: EvaluationResults;
  history: ChatConversationMessage[];
  instruction: string;
  modelId: string;
  prompts: PromptSystem;
  reasoningEffort: ChatReasoningEffort;
  signal?: AbortSignal;
  steering?: ChatSteering;
};

export type ChatSteering = {
  close(): boolean;
  connect(handler: (instruction: string) => boolean): () => void;
  drain(): string[];
  retry(): void;
};

export type ChatRunResult = {
  message: string;
  model: ModelConfig;
};

/** Builds one agent runner with provider-specific reasoning settings and scoped tools. */
export function createAgentRuntime(
  modelId: string,
  tools: Tool[] = [],
  mcpServers: MCPServer[] = [],
  reasoningEffort: ChatReasoningEffort = "medium",
): AgentRuntime {
  const { config, provider } = createModel(modelId);
  const usesResponses = config.id.startsWith("gpt-");

  return {
    agent: new OpenAIAgent({
      instructions: AGENT_INSTRUCTIONS,
      mcpServers,
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
    model: config,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: true,
    }),
  };
}

/** Runs a detached chat stream, preserving steering retries and tool event projections. */
export async function streamChatRun(
  input: ChatRunInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ChatRunResult> {
  const enabled = new Set(input.enabledTools);
  const tools: Tool[] = [];
  const promptToolsEnabled = enabled.has("prompt-library");
  const evaluationsEnabled = enabled.has("evaluations");
  if (promptToolsEnabled) tools.push(...createPromptLibraryTools(input.prompts));
  if (evaluationsEnabled)
    tools.push(
      createEvaluationTool(input.evaluations, input.chatId, getEvaluationModelReferences),
      ...createEvaluationDataTools(input.evaluationResults),
    );
  let exaServer: MCPServer | undefined;

  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    if (enabled.has("web-search")) exaServer = await connectOpenAiAgentsExaSearch();
    if (input.signal?.aborted) throw abortReason(input.signal);
    const runtime = createAgentRuntime(
      input.modelId,
      tools,
      exaServer ? [exaServer] : [],
      input.reasoningEffort,
    );
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
        return { message: run.finalOutput, model: runtime.model };
      }
    }
  } finally {
    await exaServer?.close();
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

/** Runs a prompt-edit stream and disposes both the temporary workspace and MCP server. */
export async function streamPromptEdit(
  input: PromptEditInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<PromptEdit> {
  const workspace = await createPromptWorkspace(input.markdown);
  let exaServer: MCPServer | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= closeRunResources(exaServer, workspace.dispose);
    return cleanupPromise;
  };

  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    exaServer = await connectOpenAiAgentsExaSearch();
    if (input.signal?.aborted) throw abortReason(input.signal);
    const runtime = createAgentRuntime(input.modelId, createScopedFsTools(workspace), [exaServer]);
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
      markdown: await workspace.read(),
      message: run.finalOutput,
      model: runtime.model,
    };
  } finally {
    await cleanup();
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
        input: getToolInput(event.item.rawItem),
        name: identity.name,
        state: "running",
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
      output,
      state: "completed",
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
  return { promptId: id, revisionId, type: "prompt-revision" };
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
  if (name === "list_prompts") return "Listed saved prompts.";
  if (name === "create_prompt") return "Created a prompt.";
  if (name === "read_prompt") return "Read the current prompt.";
  if (name === "edit_prompt") return "Updated the working prompt.";
  if (name === "evaluate") return "Started an evaluation run.";
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

/** Closes external run resources and always disposes the temporary workspace. */
async function closeRunResources(
  exaServer: MCPServer | undefined,
  disposeWorkspace: () => Promise<void>,
): Promise<void> {
  try {
    await exaServer?.close();
  } finally {
    await disposeWorkspace();
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The run was stopped.", "AbortError");
}
