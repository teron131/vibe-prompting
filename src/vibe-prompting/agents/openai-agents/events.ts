/** Translates provider reasoning and tool events into application stream events while preserving call identity and prompt revision links. */

import type { RunStreamEvent } from "@openai/agents";

import { readChatCompletionsReasoning } from "./reasoning.ts";

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

/** Projects provider stream events into the small event contract consumed by the frontend. */
export function projectEvent(
  event: RunStreamEvent,
  toolNames: Map<string, string>,
): AgentStreamEvent[] {
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
