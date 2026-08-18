/** Adapts general conversation commands to detached NDJSON agent streams without making browser lifetime the run owner. */

import {
  type AgentStreamEvent,
  CHAT_TOOL_IDS,
  type ClaimedConversationRun,
  generateChatMetadata,
  getApplicationServices,
  isConfiguredModelId,
  type StoredMessagePart,
  streamChatRun,
} from "vibe-prompting/server";

import type {
  Attachment,
  ChatReasoningEffort,
  ChatRequest,
  ChatResponse,
  ChatToolId,
  DeleteChatResponse,
  RunEvent,
  StopChatResponse,
} from "@/contracts/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const METADATA_EVERY_MESSAGES = 3;

export async function GET(request: Request) {
  try {
    const chatId = requireUuid(new URL(request.url).searchParams.get("id"), "Chat ID");
    const services = await getApplicationServices();
    const payload = {
      active: services.runs.isActive(chatId),
      conversation: await services.conversations.getConversation(chatId),
    } satisfies ChatResponse;
    return Response.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let claim: ClaimedConversationRun | undefined;
  try {
    const input = parseChatRequest(await request.json());
    if (!isConfiguredModelId(input.modelId)) {
      throw new RequestError(`Unknown configured model: ${input.modelId}.`, 400);
    }
    const services = await getApplicationServices();

    claim = services.runs.claim(input.chatId);
    let history: Array<{ role: "assistant" | "user"; text: string }> = [];
    let conversation;
    let existing = true;
    try {
      conversation = await services.conversations.getConversation(input.chatId);
      history = conversation.messages.flatMap((message) => {
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        return text ? [{ role: message.role, text }] : [];
      });
    } catch (error) {
      if (!isChatNotFoundError(error)) throw error;
      existing = false;
    }
    const attachments = input.attachments.map((attachment) => ({
      ...attachment,
      type: "file" as const,
    }));
    if (existing) {
      conversation = await services.conversations.appendUserMessage({
        attachments,
        chatId: input.chatId,
        instruction: input.instruction,
        modelId: input.modelId,
      });
    } else {
      conversation = await services.conversations.createWithUserMessage({
        attachments,
        chatId: input.chatId,
        instruction: input.instruction,
        modelId: input.modelId,
      });
    }
    const userMessageCount = conversation.messages.filter(({ role }) => role === "user").length;
    const shouldUpdateMetadata = !existing || userMessageCount % METADATA_EVERY_MESSAGES === 0;
    const metadataPromise = shouldUpdateMetadata
      ? generateChatMetadata({
          currentIcon: conversation.chat.icon,
          currentTitle: conversation.chat.title,
          messages: conversation.messages,
        })
          .then(async (metadata) => {
            if (!metadata) return null;
            await services.conversations.updateMetadata({ chatId: input.chatId, ...metadata });
            return metadata;
          })
          .catch((error) => {
            console.warn("Chat metadata update failed", input.chatId, error);
            return null;
          })
      : undefined;

    const stream = createNdjsonStream(claim);
    claim.start(async () => {
      const collected = new CollectedAssistantParts();
      const result = await streamChatRun(
        {
          attachments: input.attachments,
          chatId: input.chatId,
          enabledTools: input.enabledTools,
          evaluations: services.evaluations,
          history,
          instruction: input.instruction,
          modelId: input.modelId,
          prompts: services.prompts,
          reasoningEffort: input.reasoningEffort,
          signal: claim?.signal,
        },
        (event) => {
          collected.add(event);
          claim?.publish(event);
        },
      );
      if (claim?.signal.aborted) throw claim.signal.reason;
      await services.conversations.appendAssistantMessage({
        chatId: input.chatId,
        metadata: {
          completedAt: new Date().toISOString(),
          enabledTools: input.enabledTools,
          modelId: result.model.id,
          reasoningEffort: input.reasoningEffort,
        },
        parts: collected.finish(result.message),
      });
      const metadata = await metadataPromise;
      if (metadata) {
        claim?.publish({ chatId: input.chatId, ...metadata, type: "chat-metadata" });
      }
      claim?.publish({ type: "finish" });
    });

    return new Response(stream, {
      headers: {
        ...NO_STORE_HEADERS,
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-chat-id": input.chatId,
      },
    });
  } catch (error) {
    claim?.release();
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const chatId = requireUuid(readRecord(await request.json()).chatId, "Chat ID");
    const services = await getApplicationServices();
    const payload = { stopped: services.runs.stop(chatId) } satisfies StopChatResponse;
    return Response.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const chatId = requireUuid(new URL(request.url).searchParams.get("id"), "Chat ID");
    const services = await getApplicationServices();
    await services.runs.stopAndWait(chatId);
    await services.conversations.deleteChat(chatId);
    const payload = { deleted: true } satisfies DeleteChatResponse;
    return Response.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

class CollectedAssistantParts {
  readonly #evaluations: StoredMessagePart[] = [];
  readonly #reasoning: StoredMessagePart[] = [];
  readonly #tools = new Map<string, Extract<StoredMessagePart, { type: "tool" }>>();

  add(event: AgentStreamEvent): void {
    if (event.type === "reasoning") {
      this.#reasoning.push({ type: "reasoning", summary: event.summary });
    } else if (event.type === "tool") {
      this.#tools.set(event.callId, { ...this.#tools.get(event.callId), ...event });
    } else if (event.type === "evaluation") {
      this.#evaluations.push({ type: "evaluation", report: event.report });
    }
  }

  finish(message: string): StoredMessagePart[] {
    return [
      ...this.#reasoning,
      ...this.#tools.values(),
      ...this.#evaluations,
      { type: "text", text: message },
    ];
  }
}

function createNdjsonStream(claim: ClaimedConversationRun) {
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = claim.subscribe((event) => {
        const browserEvent: RunEvent = event;
        controller.enqueue(encoder.encode(`${JSON.stringify(browserEvent)}\n`));
        if (
          browserEvent.type === "finish" ||
          browserEvent.type === "stopped" ||
          browserEvent.type === "error"
        ) {
          unsubscribe();
          controller.close();
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });
}

function parseChatRequest(value: unknown): ChatRequest {
  const record = readRecord(value);
  return {
    attachments: requireAttachments(record.attachments),
    chatId: requireUuid(record.chatId, "Chat ID"),
    enabledTools: requireToolIds(record.enabledTools),
    instruction: requireText(record.instruction, "Message"),
    modelId: requireText(record.modelId, "Model"),
    reasoningEffort: requireReasoningEffort(record.reasoningEffort),
  };
}

function requireAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value) || value.length > 4)
    throw new RequestError("Attachments must contain at most four files.", 400);
  return value.map((item) => {
    const record = readRecord(item);
    const dataUrl = requireText(record.dataUrl, "Attachment data");
    const mediaType = requireText(record.mediaType, "Attachment media type");
    const name = requireText(record.name, "Attachment name");
    const size = typeof record.size === "number" ? record.size : Number.NaN;
    if (!Number.isInteger(size) || size < 0 || size > 8 * 1024 * 1024)
      throw new RequestError("Each attachment must be no larger than 8 MB.", 400);
    if (!dataUrl.startsWith(`data:${mediaType}`))
      throw new RequestError("Attachment data does not match its media type.", 400);
    return { dataUrl, mediaType, name, size };
  });
}

function requireReasoningEffort(value: unknown): ChatReasoningEffort {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new RequestError("Reasoning effort must be low, medium, high, or extra high.", 400);
}

function requireToolIds(value: unknown): ChatToolId[] {
  if (!Array.isArray(value)) throw new RequestError("Enabled tools must be an array.", 400);
  const allowed = new Set<string>(CHAT_TOOL_IDS);
  const tools = value.filter((item): item is string => typeof item === "string");
  if (tools.length !== value.length || tools.some((item) => !allowed.has(item)))
    throw new RequestError("Enabled tools contain an unknown tool.", 400);
  return [...new Set(tools)] as ChatToolId[];
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Request body must contain a JSON object.", 400);
  }
  return value as Record<string, unknown>;
}

function isChatNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "ChatNotFoundError" &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new RequestError(`${label} must be text.`, 400);
  return value;
}

function requireText(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) throw new RequestError(`${label} is required.`, 400);
  return text;
}

function requireUuid(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new RequestError(`${label} must be a UUID.`, 400);
  }
  return text;
}

class RequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Request body must contain valid JSON." }, { status: 400 });
  }
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message =
    status < 500 && error instanceof Error
      ? error.message
      : "The server could not complete the request.";
  const retryAfter = readRetryAfter(error);
  return Response.json(
    { error: message },
    {
      headers: {
        ...NO_STORE_HEADERS,
        ...(retryAfter === null ? {} : { "retry-after": String(retryAfter) }),
      },
      status,
    },
  );
}

function readRetryAfter(error: unknown): number | null {
  if (
    !error ||
    typeof error !== "object" ||
    !("retryAfterSeconds" in error) ||
    typeof error.retryAfterSeconds !== "number" ||
    !Number.isInteger(error.retryAfterSeconds) ||
    error.retryAfterSeconds < 1
  ) {
    return null;
  }
  return error.retryAfterSeconds;
}
