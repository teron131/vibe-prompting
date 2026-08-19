/** Composes prompt editing, safe stream projection, scoped tools, and idempotent run cleanup. */

import {
  type AgentInputItem,
  type MCPServer,
  Agent as OpenAIAgent,
  OpenAIProvider,
  Runner,
  type RunStreamEvent,
  type Tool,
} from "@openai/agents";

import { normalizeChatCompletionsReasoning } from "../clients/chat-completions-reasoning.ts";
import { connectExaSearch } from "../clients/exa.ts";
import { preserveGeminiToolCallSignatures } from "../clients/gemini-tool-calls.ts";
import { loadRuntimeConfig, type ModelConfig, resolveModelPlatform } from "../config.ts";
import type { EvaluationRuns } from "../evaluation/runs.ts";
import { getModelSpendLimit } from "../model-spend-limit.ts";
import type { PromptStore } from "../prompts/store.ts";
import { createPromptWorkspace } from "./artifacts.ts";
import { AGENT_INSTRUCTIONS } from "./instructions.ts";
import { createPromptEvaluationTool, type PromptEvaluationSnapshot } from "./tools/evaluation.ts";
import { createPersistedEvaluationTool, createPromptLibraryTools } from "./tools/prompt-library.ts";
import { createScopedFsTools } from "./tools/scoped-fs.ts";

export type AgentRuntime = {
  agent: OpenAIAgent;
  model: ModelConfig;
  runner: Runner;
};

export type AgentStreamEvent =
  | { delta: string; type: "text-delta" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "running";
      summary?: string;
      type: "tool";
    }
  | { summary: string; type: "reasoning" }
  | { report: PromptEvaluationSnapshot["report"]; type: "evaluation" };

export type PromptEdit = {
  evaluations: PromptEvaluationSnapshot[];
  markdown: string;
  message: string;
  model: ModelConfig;
};

export type PromptEditInput = {
  instruction: string;
  markdown: string;
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
  history: ChatConversationMessage[];
  instruction: string;
  modelId: string;
  prompts: PromptStore;
  reasoningEffort: ChatReasoningEffort;
  signal?: AbortSignal;
};

export type ChatRunResult = {
  message: string;
  model: ModelConfig;
};

export function createAgentRuntime(
  modelId: string,
  tools: Tool[] = [],
  mcpServers: MCPServer[] = [],
  reasoningEffort: ChatReasoningEffort = "medium",
): AgentRuntime {
  const config = loadRuntimeConfig();
  const model = config.models.find(({ id }) => id === modelId);
  if (!model) throw new Error(`Unknown configured model: ${modelId}.`);

  const platform = resolveModelPlatform(model, config);
  const usesResponses = platform.id === "cliproxy";
  const openAIProvider = new OpenAIProvider({
    apiKey: platform.apiKey,
    baseURL: platform.baseURL,
    strictFeatureValidation: true,
    useResponses: usesResponses,
  });
  const reasoningProvider = usesResponses
    ? openAIProvider
    : normalizeChatCompletionsReasoning(openAIProvider);
  const modelProvider =
    platform.id === "gemini"
      ? preserveGeminiToolCallSignatures(reasoningProvider)
      : reasoningProvider;

  return {
    agent: new OpenAIAgent({
      instructions: AGENT_INSTRUCTIONS,
      mcpServers,
      model: model.id,
      modelSettings:
        platform.id === "gemini"
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
                summary: platform.id === "cliproxy" ? "detailed" : "auto",
              },
            },
      name: "Vibe Prompting",
      tools,
    }),
    model,
    runner: new Runner({
      modelProvider,
      tracingDisabled: true,
    }),
  };
}

export async function streamChatRun(
  input: ChatRunInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ChatRunResult> {
  const enabled = new Set(input.enabledTools);
  const tools: Tool[] = [];
  if (enabled.has("prompt-library")) tools.push(...createPromptLibraryTools(input.prompts));
  if (enabled.has("evaluations"))
    tools.push(createPersistedEvaluationTool(input.evaluations, input.chatId));
  let exaServer: MCPServer | undefined;

  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    if (enabled.has("web-search")) exaServer = await connectExaSearch();
    if (input.signal?.aborted) throw abortReason(input.signal);
    const runtime = createAgentRuntime(
      input.modelId,
      tools,
      exaServer ? [exaServer] : [],
      input.reasoningEffort,
    );
    const spendLimit = getModelSpendLimit();
    await spendLimit?.assertCanSpend(runtime.model);
    const run = await runtime.runner.run(runtime.agent, formatConversation(input), {
      signal: input.signal,
      stream: true,
    });
    const calledTools = new Map<string, string>();
    for await (const event of run) {
      for (const item of projectEvent(event, calledTools)) onEvent(item);
    }
    try {
      await run.completed;
    } finally {
      await spendLimit?.record(runtime.model, run.state.usage);
    }
    if (run.error) throw run.error;
    if (typeof run.finalOutput !== "string") throw new Error("The model did not return text.");
    return { message: run.finalOutput, model: runtime.model };
  } finally {
    await exaServer?.close();
  }
}

export async function editPrompt(input: PromptEditInput): Promise<PromptEdit> {
  return streamPromptEdit(input, () => undefined);
}

export async function streamPromptEdit(
  input: PromptEditInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<PromptEdit> {
  const workspace = await createPromptWorkspace(input.markdown);
  const evaluations: PromptEvaluationSnapshot[] = [];
  let exaServer: MCPServer | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= closeRunResources(exaServer, workspace.dispose);
    return cleanupPromise;
  };

  try {
    if (input.signal?.aborted) throw abortReason(input.signal);
    exaServer = await connectExaSearch();
    if (input.signal?.aborted) throw abortReason(input.signal);
    const runtime = createAgentRuntime(
      input.modelId,
      [
        ...createScopedFsTools(workspace),
        createPromptEvaluationTool(workspace, (snapshot) => {
          evaluations.push(snapshot);
          onEvent({ type: "evaluation", report: snapshot.report });
        }),
      ],
      [exaServer],
    );
    const spendLimit = getModelSpendLimit();
    await spendLimit?.assertCanSpend(runtime.model);
    const run = await runtime.runner.run(runtime.agent, input.instruction, {
      signal: input.signal,
      stream: true,
    });
    const tools = new Map<string, string>();
    for await (const event of run) {
      for (const item of projectEvent(event, tools)) onEvent(item);
    }
    try {
      await run.completed;
    } finally {
      await spendLimit?.record(runtime.model, run.state.usage);
    }
    if (run.error) throw run.error;
    if (typeof run.finalOutput !== "string") {
      throw new Error("The model did not return text.");
    }
    return {
      evaluations,
      markdown: await workspace.read(),
      message: run.finalOutput,
      model: runtime.model,
    };
  } finally {
    await cleanup();
  }
}

function projectEvent(event: RunStreamEvent, tools: Map<string, string>): AgentStreamEvent[] {
  if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
    return event.data.delta ? [{ type: "text-delta", delta: event.data.delta }] : [];
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
    tools.set(identity.callId, identity.name);
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
    const callId = identity?.callId ?? getItemCallId(event.item);
    if (!callId) return [];
    const name = identity?.name ?? tools.get(callId) ?? "tool";
    return [
      {
        type: "tool",
        callId,
        name,
        output: normalizeEventValue("output" in event.item ? event.item.output : undefined),
        state: "completed",
        summary: summarizeTool(name, "output" in event.item ? event.item.output : undefined),
      },
    ];
  }
  return [];
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

function getItemCallId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("callId" in value)) return undefined;
  return typeof value.callId === "string" ? value.callId : undefined;
}

function summarizeTool(name: string, output: unknown): string {
  if (name === "list_prompts") return "Listed saved prompts.";
  if (name === "create_prompt") return "Created a prompt artifact.";
  if (name === "read_prompt") return "Read the current prompt.";
  if (name === "edit_prompt") return "Updated the working prompt.";
  if (name === "evaluate_prompt") return "Evaluated the working prompt.";
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
