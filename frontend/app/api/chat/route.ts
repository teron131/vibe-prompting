/** Adapts general conversation commands to detached NDJSON agent streams without making browser lifetime the run owner. */

import {
  type AgentStreamEvent,
  CHAT_TOOL_IDS,
  type ClaimedConversationRun,
  generateChatMetadata,
  getApplicationServices,
  isConfiguredModelId,
  PromptRevisionNotFoundError,
  type PromptSystem,
  type StoredMessagePart,
  type StoredPrompt,
  streamChatRun,
} from "vibe-prompting/server";

import type {
  Attachment,
  ChatReasoningEffort,
  ChatRequest,
  ChatResponse,
  ChatToolId,
  ChatWorkspaceContext,
  DeleteChatResponse,
  PromptQuote,
  RunEvent,
  SteerChatResponse,
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
    const run = services.runs.snapshot(chatId);
    const payload = {
      active: run.active,
      conversation: await services.conversations.getConversation(chatId),
      events: run.events,
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
    if (!(await isConfiguredModelId(input.modelId))) {
      throw new RequestError(`Unknown configured model: ${input.modelId}.`, 400);
    }
    const services = await getApplicationServices();
    const [activePrompt, quotes] = await Promise.all([
      input.workspace.activePromptId
        ? services.prompts.getPrompt(input.workspace.activePromptId)
        : undefined,
      validatePromptQuotes(services.prompts, input.quotes),
    ]);

    claim = services.runs.claim(input.chatId);
    let conversation;
    let existing = true;
    try {
      conversation = await services.conversations.getConversation(input.chatId);
    } catch (error) {
      if (!isChatNotFoundError(error)) throw error;
      if (input.replaceFromMessageId) throw error;
      existing = false;
    }
    const attachments = input.attachments.map((attachment) => ({
      ...attachment,
      type: "file" as const,
    }));
    const storedQuotes = quotes.map((quote) => ({ ...quote, type: "prompt-quote" as const }));
    if (input.replaceFromMessageId) {
      conversation = await services.conversations.replaceUserMessage({
        attachments,
        chatId: input.chatId,
        context: input.workspace,
        instruction: input.instruction,
        messageId: input.messageId,
        modelId: input.modelId,
        quotes: storedQuotes,
        replaceFromMessageId: input.replaceFromMessageId,
      });
    } else if (existing) {
      conversation = await services.conversations.appendUserMessage({
        attachments,
        chatId: input.chatId,
        context: input.workspace,
        instruction: input.instruction,
        messageId: input.messageId,
        modelId: input.modelId,
        quotes: storedQuotes,
      });
    } else {
      conversation = await services.conversations.createWithUserMessage({
        attachments,
        chatId: input.chatId,
        context: input.workspace,
        instruction: input.instruction,
        messageId: input.messageId,
        modelId: input.modelId,
        quotes: storedQuotes,
      });
    }
    const history = projectRunHistory(conversation.messages, input.messageId);
    const userMessageCount = conversation.messages.filter(({ role }) => role === "user").length;
    const shouldUpdateMetadata =
      Boolean(input.replaceFromMessageId) ||
      !existing ||
      userMessageCount % METADATA_EVERY_MESSAGES === 0;
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
          enabledTools: input.workspace.enabledTools,
          evaluations: services.evaluations,
          history,
          instruction: formatWorkspaceInstruction(input.instruction, activePrompt, quotes),
          modelId: input.modelId,
          prompts: services.prompts,
          reasoningEffort: input.workspace.reasoningEffort,
          signal: claim?.signal,
          steering: claim?.steering,
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
          activePromptId: activePrompt?.id ?? null,
          activePromptRevisionId: activePrompt?.revisionId ?? null,
          enabledTools: input.workspace.enabledTools,
          modelId: result.model.id,
          reasoningEffort: input.workspace.reasoningEffort,
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

export async function PUT(request: Request) {
  try {
    const input = parseSteeringRequest(await request.json());
    if (!(await isConfiguredModelId(input.modelId))) {
      throw new RequestError(`Unknown configured model: ${input.modelId}.`, 400);
    }
    const services = await getApplicationServices();
    if (!services.runs.steer(input.chatId, input.instruction)) {
      throw new RequestError("The agent run is no longer available to steer.", 409);
    }
    await services.conversations.appendUserMessage({
      attachments: [],
      chatId: input.chatId,
      context: input.workspace,
      instruction: input.instruction,
      messageId: input.messageId,
      modelId: input.modelId,
      quotes: [],
    });
    const payload = { accepted: true } satisfies SteerChatResponse;
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
  readonly #reasoning: StoredMessagePart[] = [];
  readonly #tools = new Map<string, Extract<StoredMessagePart, { type: "tool" }>>();

  add(event: AgentStreamEvent): void {
    if (event.type === "response-reset") {
      this.#reasoning.length = 0;
    } else if (event.type === "reasoning") {
      this.#reasoning.push({ type: "reasoning", summary: event.summary });
    } else if (event.type === "tool") {
      this.#tools.set(event.callId, { ...this.#tools.get(event.callId), ...event });
    }
  }

  finish(message: string): StoredMessagePart[] {
    return [...this.#reasoning, ...this.#tools.values(), { type: "text", text: message }];
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
  const input: ChatRequest = {
    attachments: requireAttachments(record.attachments),
    chatId: requireUuid(record.chatId, "Chat ID"),
    instruction: requireText(record.instruction, "Message"),
    messageId: requireUuid(record.messageId, "Message ID"),
    modelId: requireText(record.modelId, "Model"),
    quotes: requirePromptQuotes(record.quotes),
    replaceFromMessageId:
      record.replaceFromMessageId === undefined
        ? undefined
        : requireUuid(record.replaceFromMessageId, "Replacement message ID"),
    workspace: requireWorkspaceContext(record.workspace),
  };
  if (input.replaceFromMessageId && input.messageId !== input.replaceFromMessageId) {
    throw new RequestError("A replacement must reuse the selected user message ID.", 400);
  }
  return input;
}

function parseSteeringRequest(value: unknown) {
  const record = readRecord(value);
  return {
    chatId: requireUuid(record.chatId, "Chat ID"),
    instruction: requireText(record.instruction, "Steering message"),
    messageId: requireUuid(record.messageId, "Message ID"),
    modelId: requireText(record.modelId, "Model"),
    workspace: requireWorkspaceContext(record.workspace),
  };
}

function projectRunHistory(
  messages: ChatResponse["conversation"]["messages"],
  currentMessageId: string,
): Array<{ role: "assistant" | "user"; text: string }> {
  return messages.flatMap((message) => {
    if (message.id === currentMessageId) return [];
    const text = message.parts
      .filter((part) => part.type === "text" || part.type === "prompt-quote")
      .map((part) =>
        part.type === "prompt-quote"
          ? `Quoted from ${part.title} revision ${part.revisionId.slice(0, 8)}:\n${part.text}`
          : part.text,
      )
      .join("\n");
    return text ? [{ role: message.role, text }] : [];
  });
}

function requireWorkspaceContext(value: unknown): ChatWorkspaceContext {
  const record = readRecord(value);
  return {
    activePromptId:
      record.activePromptId === null
        ? null
        : requireUuid(record.activePromptId, "Active prompt ID"),
    enabledTools: requireToolIds(record.enabledTools),
    panelOpen: record.panelOpen !== false,
    reasoningEffort: requireReasoningEffort(record.reasoningEffort),
  };
}

function requirePromptQuotes(value: unknown): PromptQuote[] {
  if (!Array.isArray(value) || value.length > 6)
    throw new RequestError("Prompt quotes must contain at most six passages.", 400);
  return value.map((item) => {
    const record = readRecord(item);
    const text = requireText(record.text, "Quoted prompt text");
    if (text.length > 4_000)
      throw new RequestError("Each prompt quote must be no longer than 4,000 characters.", 400);
    return {
      promptId: requireUuid(record.promptId, "Quoted prompt ID"),
      revisionId: requireUuid(record.revisionId, "Quoted revision ID"),
      text,
      title: requireText(record.title, "Quoted prompt title"),
    };
  });
}

async function validatePromptQuotes(
  prompts: PromptSystem,
  quotes: PromptQuote[],
): Promise<PromptQuote[]> {
  return Promise.all(
    quotes.map(async (quote) => {
      const prompt = await prompts.getPrompt(quote.promptId);
      const revision = await prompts
        .getRevision(quote.promptId, quote.revisionId)
        .catch((error) => {
          if (error instanceof PromptRevisionNotFoundError) {
            throw new RequestError("A quoted prompt revision was not found.", 400);
          }
          throw error;
        });
      if (!revision.markdown.includes(quote.text))
        throw new RequestError("Quoted prompt text no longer matches its revision.", 400);
      return { ...quote, title: prompt.title };
    }),
  );
}

function formatWorkspaceInstruction(
  instruction: string,
  activePrompt: StoredPrompt | undefined,
  quotes: PromptQuote[],
): string {
  const context: string[] = [];
  if (activePrompt) {
    context.push(
      `Current prompt: ${activePrompt.title} (prompt ${activePrompt.id}, revision ${activePrompt.revisionId}).\n<prompt_markdown>\n${activePrompt.markdown}\n</prompt_markdown>`,
    );
  }
  for (const quote of quotes) {
    context.push(
      `Quoted passage from ${quote.title} (prompt ${quote.promptId}, revision ${quote.revisionId}):\n<prompt_quote>\n${quote.text}\n</prompt_quote>`,
    );
  }
  return context.length ? `${context.join("\n\n")}\n\nUser request:\n${instruction}` : instruction;
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
