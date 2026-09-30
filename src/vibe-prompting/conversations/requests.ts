/** Validates conversation commands before side effects while preserving the chat transport's input and error contracts. */

import {
  type Attachment,
  CHAT_TOOL_IDS,
  type ChatQuote,
  type ChatReasoningEffort,
  type ChatRequest,
  type ChatToolId,
  type ChatWorkspaceContext,
  type SteerChatRequest,
  type TargetRunQuote,
} from "./schemas.ts";

/** Preserves exact input normalization and replacement identity checks before a chat is claimed. */
export function parseChatRequest(value: unknown): ChatRequest {
  const record = requireRecord(value);
  const input: ChatRequest = {
    attachments: requireAttachments(record.attachments),
    chatId: requireUuid(record.chatId, "Chat ID"),
    instruction: requireText(record.instruction, "Message"),
    messageId: requireUuid(record.messageId, "Message ID"),
    modelId: requireText(record.modelId, "Model"),
    quotes: requireChatQuotes(record.quotes),
    replaceFromMessageId:
      record.replaceFromMessageId === undefined
        ? undefined
        : requireUuid(record.replaceFromMessageId, "Replacement message ID"),
    workspace: requireWorkspaceContext(record.workspace),
  };
  if (input.replaceFromMessageId && input.messageId !== input.replaceFromMessageId) {
    throw new ChatRequestError("A replacement must reuse the selected user message ID.", 400);
  }
  return input;
}

export function parseSteeringRequest(value: unknown): SteerChatRequest {
  const record = requireRecord(value);
  return {
    chatId: requireUuid(record.chatId, "Chat ID"),
    instruction: requireText(record.instruction, "Steering message"),
    messageId: requireUuid(record.messageId, "Message ID"),
    modelId: requireText(record.modelId, "Model"),
    workspace: requireWorkspaceContext(record.workspace),
  };
}

function requireWorkspaceContext(value: unknown): ChatWorkspaceContext {
  const record = requireRecord(value);
  return {
    activeContextId:
      record.activeContextId === null
        ? null
        : requireUuid(record.activeContextId, "Active context ID"),
    enabledTools: requireToolIds(record.enabledTools),
    panelOpen: record.panelOpen !== false,
    reasoningEffort: requireReasoningEffort(record.reasoningEffort),
  };
}

/** Limits quote payloads while retaining the exact revision identifiers used for later verification. */
function requireChatQuotes(value: unknown): ChatQuote[] {
  if (!Array.isArray(value) || value.length > 6)
    throw new ChatRequestError("Quotes must contain at most six references.", 400);
  return value.map((item) => {
    const record = requireRecord(item);
    if (record.runId !== undefined) {
      return {
        runId: requireUuid(record.runId, "Quoted Target Run ID"),
        title: requireText(record.title, "Quoted Target Run title"),
      } satisfies TargetRunQuote;
    }
    const text = requireText(record.text, "Quoted context text");
    if (text.length > 4_000)
      throw new ChatRequestError(
        "Each context quote must be no longer than 4,000 characters.",
        400,
      );
    return {
      contextId: requireUuid(record.contextId, "Quoted context ID"),
      revisionId: requireUuid(record.revisionId, "Quoted revision ID"),
      text,
      title: requireText(record.title, "Quoted context title"),
    };
  });
}

/** Validates attachment count, byte size, and declared MIME prefix without rewriting file contents. */
function requireAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value) || value.length > 4)
    throw new ChatRequestError("Attachments must contain at most four files.", 400);
  return value.map((item) => {
    const record = requireRecord(item);
    const dataUrl = requireText(record.dataUrl, "Attachment data");
    const mediaType = requireText(record.mediaType, "Attachment media type");
    const name = requireText(record.name, "Attachment name");
    const size = typeof record.size === "number" ? record.size : Number.NaN;
    if (!Number.isInteger(size) || size < 0 || size > 8 * 1024 * 1024)
      throw new ChatRequestError("Each attachment must be no larger than 8 MB.", 400);
    if (!dataUrl.startsWith(`data:${mediaType}`))
      throw new ChatRequestError("Attachment data does not match its media type.", 400);
    return { dataUrl, mediaType, name, size };
  });
}

function requireReasoningEffort(value: unknown): ChatReasoningEffort {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new ChatRequestError("Reasoning effort must be low, medium, high, or extra high.", 400);
}

function requireToolIds(value: unknown): ChatToolId[] {
  if (!Array.isArray(value)) throw new ChatRequestError("Enabled tools must be an array.", 400);
  const allowed = new Set<string>(CHAT_TOOL_IDS);
  const tools = value.filter((item): item is string => typeof item === "string");
  if (tools.length !== value.length || tools.some((item) => !allowed.has(item)))
    throw new ChatRequestError("Enabled tools contain an unknown tool.", 400);
  return [...new Set(tools)] as ChatToolId[];
}

export class ChatRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "ChatRequestError";
    this.statusCode = statusCode;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatRequestError("Request body must contain a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ChatRequestError(`${label} must be text.`);
  return value;
}

function requireText(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) throw new ChatRequestError(`${label} is required.`);
  return text;
}

export function requireUuid(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!UUID_PATTERN.test(text)) throw new ChatRequestError(`${label} must be a UUID.`);
  return text;
}
