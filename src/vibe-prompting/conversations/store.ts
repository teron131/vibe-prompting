/** Owns general chat persistence, history projection, search, and assistant turn completion. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { Database, DatabaseClient } from "../database.ts";
import type { HybridSearch } from "../search.ts";
import { type ChatMetadata, validateChatMetadata } from "./metadata.ts";

export type StoredMessagePart =
  | { text: string; type: "text" }
  | { dataUrl: string; mediaType: string; name: string; size: number; type: "file" }
  | { summary: string; type: "reasoning" }
  | {
      callId: string;
      name: string;
      input?: unknown;
      output?: unknown;
      state: "completed" | "failed" | "running";
      summary?: string;
      type: "tool";
    }
  | { promptId: string; revisionId: string; type: "prompt-revision" }
  | {
      promptId: string;
      revisionId: string;
      text: string;
      title: string;
      type: "prompt-quote";
    }
  | { report: unknown; runId?: string; type: "evaluation" };

export type ChatWorkspaceContext = {
  activePromptId: string | null;
  enabledTools: Array<"prompt-library" | "evaluations" | "web-search">;
  panelOpen: boolean;
  reasoningEffort: "high" | "low" | "medium" | "xhigh";
};

export type ChatMessage = {
  chatId: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown>;
  parts: StoredMessagePart[];
  role: "assistant" | "user";
};

export type ChatSummary = {
  createdAt: string;
  icon: string;
  id: string;
  modelId: string;
  title: string;
  updatedAt: string;
};

export type Conversation = {
  chat: ChatSummary;
  context: ChatWorkspaceContext;
  messages: ChatMessage[];
};

export type ChatPage = {
  chats: ChatSummary[];
  nextCursor: string | null;
};

type ChatRow = {
  createdAt: Date;
  icon: string;
  id: string;
  modelId: string;
  title: string;
  updatedAt: Date;
};

type ChatSearchRow = ChatRow & { searchText: string };

type MessageRow = {
  chatId: string;
  createdAt: Date;
  id: string;
  metadata: Record<string, unknown>;
  parts: StoredMessagePart[];
  role: "assistant" | "user";
};

type ConversationRow = ChatRow & { context: unknown };

type Cursor = {
  id: string;
  updatedAt: string;
};

type UsageRow = {
  dayCount: number;
  dayRetryAfterSeconds: number | null;
  hourCount: number;
  hourRetryAfterSeconds: number | null;
};

type UserMessageInput = {
  attachments?: Array<Extract<StoredMessagePart, { type: "file" }>>;
  chatId: string;
  context: ChatWorkspaceContext;
  instruction: string;
  messageId: string;
  modelId: string;
  quotes?: Array<Extract<StoredMessagePart, { type: "prompt-quote" }>>;
};

const CHAT_MESSAGES_PER_HOUR = 300;
const CHAT_MESSAGES_PER_DAY = 1_500;
const CHAT_USAGE_LOCK = 1_450_701_648;
const WORKSPACE_TOOL_IDS = new Set(["prompt-library", "evaluations", "web-search"]);

export class ChatNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(chatId: string) {
    super(`Chat ${chatId} was not found.`);
    this.name = "ChatNotFoundError";
  }
}

export class ChatMessageNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(chatId: string, messageId: string) {
    super(`User message ${messageId} was not found in chat ${chatId}.`);
    this.name = "ChatMessageNotFoundError";
  }
}

export class ChatMessageReplacementError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ChatMessageReplacementError";
  }
}

export class ChatRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;

  constructor(retryAfterSeconds: number) {
    super(
      `The shared deployment is limited to ${CHAT_MESSAGES_PER_HOUR} messages per hour and ${CHAT_MESSAGES_PER_DAY.toLocaleString()} messages per day.`,
    );
    this.name = "ChatRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Persists chats and messages while keeping search projection and usage limits at their storage boundaries. */
export class ConversationStore {
  readonly #database: Database;
  readonly #search: HybridSearch;

  constructor(database: Database, search: HybridSearch) {
    this.#database = database;
    this.#search = search;
  }

  /** Creates a chat and its first user turn under one usage-checked transaction. */
  async createWithUserMessage(
    input: Omit<UserMessageInput, "chatId"> & { chatId?: string },
  ): Promise<Conversation> {
    const chatId = input.chatId ?? randomUUID();
    const title = deriveTitle(input.instruction);
    return this.#database.transaction(async (sql) => {
      await claimChatUsage(sql);
      await sql`
        INSERT INTO chats (id, title, model_id, workspace_context_json)
        VALUES (
          ${chatId},
          ${title},
          ${input.modelId},
          ${sql.json(input.context as unknown as postgres.JSONValue)}
        )
      `;
      await insertMessage(sql, {
        chatId,
        id: input.messageId,
        metadata: {},
        parts: projectUserMessageParts(input),
        role: "user",
      });
      return requireConversation(sql, chatId);
    });
  }

  async appendUserMessage(input: UserMessageInput): Promise<Conversation> {
    return this.#database.transaction(async (sql) => {
      await requireChat(sql, input.chatId);
      await claimChatUsage(sql);
      await insertMessage(sql, {
        chatId: input.chatId,
        id: input.messageId,
        metadata: {},
        parts: projectUserMessageParts(input),
        role: "user",
      });
      await updateChatForUserMessage(sql, input);
      return requireConversation(sql, input.chatId);
    });
  }

  async replaceUserMessage(
    input: UserMessageInput & { replaceFromMessageId: string },
  ): Promise<Conversation> {
    return this.#database.transaction(async (sql) => {
      if (input.messageId !== input.replaceFromMessageId) {
        throw new ChatMessageReplacementError(
          "A replacement must reuse the selected user message ID.",
        );
      }
      await requireChat(sql, input.chatId);
      const [target] = await sql<Array<{ createdAt: Date; id: string; role: string }>>`
        SELECT id, role, created_at
        FROM chat_messages
        WHERE chat_id = ${input.chatId} AND id = ${input.replaceFromMessageId}
        FOR UPDATE
      `;
      if (!target) throw new ChatMessageNotFoundError(input.chatId, input.replaceFromMessageId);
      if (target.role !== "user") {
        throw new ChatMessageReplacementError(
          `Message ${input.replaceFromMessageId} is not a user message and cannot be replaced.`,
        );
      }
      await claimChatUsage(sql);
      await sql`
        DELETE FROM chat_messages
        WHERE
          chat_id = ${input.chatId}
          AND (created_at, id) >= (${target.createdAt}, ${target.id}::uuid)
      `;
      await insertMessage(sql, {
        chatId: input.chatId,
        id: input.messageId,
        metadata: {},
        parts: projectUserMessageParts(input),
        role: "user",
      });
      await updateChatForUserMessage(sql, input);
      return requireConversation(sql, input.chatId);
    });
  }

  async appendAssistantMessage(input: {
    chatId: string;
    metadata: Record<string, unknown>;
    parts: StoredMessagePart[];
  }): Promise<Conversation> {
    return this.#database.transaction(async (sql) => {
      await requireChat(sql, input.chatId);
      await insertMessage(sql, {
        chatId: input.chatId,
        metadata: input.metadata,
        parts: input.parts,
        role: "assistant",
      });
      await touchChat(sql, input.chatId);
      return requireConversation(sql, input.chatId);
    });
  }

  /** Loads one chat with its workspace context and ordered message history. */
  async getConversation(chatId: string): Promise<Conversation> {
    return this.#database.run((sql) => requireConversation(sql, chatId));
  }

  /** Lists chats with a stable updated-at cursor instead of offset pagination. */
  async listChats(input: { cursor?: string; limit?: number } = {}): Promise<ChatPage> {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    return this.#database.run(async (sql) => {
      const rows = cursor
        ? await sql<ChatRow[]>`
            SELECT id, title, icon, model_id, created_at, updated_at
            FROM chats
            WHERE (updated_at, id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit + 1}
          `
        : await sql<ChatRow[]>`
            SELECT id, title, icon, model_id, created_at, updated_at
            FROM chats
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit + 1}
          `;
      const hasMore = rows.length > limit;
      const visibleRows = rows.slice(0, limit);
      const last = visibleRows.at(-1);
      return {
        chats: visibleRows.map(projectChat),
        nextCursor:
          hasMore && last
            ? encodeCursor({ id: last.id, updatedAt: last.updatedAt.toISOString() })
            : null,
      };
    });
  }

  /** Searches chat titles and message text after releasing the database connection for embedding work. */
  async searchChats(query: string, limit = 30): Promise<ChatSummary[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const rows = await this.#database.run(
      (sql) => sql<ChatSearchRow[]>`
      SELECT
        chats.id,
        chats.title,
        chats.icon,
        chats.model_id,
        chats.created_at,
        chats.updated_at,
        COALESCE(string_agg(chat_messages.text_content, E'\n' ORDER BY chat_messages.created_at, chat_messages.id), '') AS search_text
      FROM chats
      LEFT JOIN chat_messages ON chat_messages.chat_id = chats.id
      GROUP BY chats.id
      ORDER BY chats.updated_at DESC, chats.id DESC
    `,
    );
    const hits = await this.#search.search(
      "chat",
      normalized,
      rows.map((row) => ({
        documentId: row.id,
        ownerId: row.id,
        title: row.title,
        text: row.searchText,
        updatedAt: row.updatedAt.toISOString(),
        value: projectChat(row),
      })),
    );
    return hits.slice(0, Math.min(Math.max(limit, 1), 100)).map(({ document }) => document.value);
  }

  async updateMetadata(input: { chatId: string } & ChatMetadata): Promise<ChatSummary> {
    const metadata = validateChatMetadata(input);
    return this.#database.run(async (sql) => {
      const [row] = await sql<ChatRow[]>`
        UPDATE chats
        SET title = ${metadata.title}, icon = ${metadata.icon}
        WHERE id = ${input.chatId}
        RETURNING id, title, icon, model_id, created_at, updated_at
      `;
      if (!row) throw new ChatNotFoundError(input.chatId);
      return projectChat(row);
    });
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.#database.run(async (sql) => {
      const rows = await sql`
        DELETE FROM chats
        WHERE id = ${chatId}
        RETURNING id
      `;
      if (rows.length === 0) throw new ChatNotFoundError(chatId);
    });
  }
}

async function claimChatUsage(sql: DatabaseClient): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${CHAT_USAGE_LOCK})`;
  await sql`
    DELETE FROM chat_usage_events
    WHERE accepted_at < now() - interval '1 day'
  `;
  const [usage] = await sql<UsageRow[]>`
    SELECT
      (count(*) FILTER (WHERE accepted_at >= now() - interval '1 hour'))::integer AS hour_count,
      count(*)::integer AS day_count,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (
          (MIN(accepted_at) FILTER (WHERE accepted_at >= now() - interval '1 hour'))
          + interval '1 hour' - now()
        )))::integer
      ) AS hour_retry_after_seconds,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (MIN(accepted_at) + interval '1 day' - now())))::integer
      ) AS day_retry_after_seconds
    FROM chat_usage_events
  `;
  const retryAfterSeconds = Math.max(
    (usage?.hourCount ?? 0) >= CHAT_MESSAGES_PER_HOUR ? (usage?.hourRetryAfterSeconds ?? 1) : 0,
    (usage?.dayCount ?? 0) >= CHAT_MESSAGES_PER_DAY ? (usage?.dayRetryAfterSeconds ?? 1) : 0,
  );
  if (retryAfterSeconds > 0) {
    throw new ChatRateLimitError(retryAfterSeconds);
  }
  await sql`INSERT INTO chat_usage_events DEFAULT VALUES`;
}

async function requireConversation(sql: DatabaseClient, chatId: string): Promise<Conversation> {
  const row = await requireChatRow(sql, chatId);
  const rows = await sql<MessageRow[]>`
    SELECT
      id,
      chat_id,
      role,
      parts_json AS parts,
      metadata_json AS metadata,
      created_at
    FROM chat_messages
    WHERE chat_id = ${chatId}
    ORDER BY created_at, id
  `;
  return {
    chat: projectChat(row),
    context: projectWorkspaceContext(row.context),
    messages: rows.map(projectMessage),
  };
}

async function requireChat(sql: DatabaseClient, chatId: string): Promise<ChatSummary> {
  return projectChat(await requireChatRow(sql, chatId));
}

async function requireChatRow(sql: DatabaseClient, chatId: string): Promise<ConversationRow> {
  const [row] = await sql<ConversationRow[]>`
    SELECT
      id,
      title,
      icon,
      model_id,
      workspace_context_json AS context,
      created_at,
      updated_at
    FROM chats
    WHERE id = ${chatId}
  `;
  if (!row) throw new ChatNotFoundError(chatId);
  return row;
}

async function insertMessage(
  sql: DatabaseClient,
  input: {
    chatId: string;
    id?: string;
    metadata: Record<string, unknown>;
    parts: StoredMessagePart[];
    role: "assistant" | "user";
  },
): Promise<void> {
  const textContent = input.parts
    .filter((part): part is Extract<StoredMessagePart, { type: "text" }> => part.type === "text")
    .map(({ text }) => text)
    .join("\n");
  await sql`
    INSERT INTO chat_messages (
      id,
      chat_id,
      role,
      parts_json,
      metadata_json,
      text_content
    )
    VALUES (
      ${input.id ?? randomUUID()},
      ${input.chatId},
      ${input.role},
      ${sql.json(input.parts as postgres.JSONValue[])},
      ${sql.json(input.metadata as postgres.JSONValue)},
      ${textContent}
    )
  `;
}

function projectUserMessageParts(
  input: Pick<UserMessageInput, "attachments" | "instruction" | "quotes">,
): StoredMessagePart[] {
  return [
    ...(input.attachments ?? []),
    ...(input.quotes ?? []),
    { type: "text", text: input.instruction },
  ];
}

async function updateChatForUserMessage(
  sql: DatabaseClient,
  input: Pick<UserMessageInput, "chatId" | "context" | "modelId">,
): Promise<void> {
  await sql`
    UPDATE chats
    SET
      model_id = ${input.modelId},
      workspace_context_json = ${sql.json(input.context as unknown as postgres.JSONValue)},
      updated_at = NOW()
    WHERE id = ${input.chatId}
  `;
}

async function touchChat(sql: DatabaseClient, chatId: string): Promise<void> {
  await sql`
    UPDATE chats
    SET updated_at = now()
    WHERE id = ${chatId}
  `;
}

function projectChat(row: ChatRow): ChatSummary {
  return {
    createdAt: row.createdAt.toISOString(),
    icon: row.icon,
    id: row.id,
    modelId: row.modelId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectMessage(row: MessageRow): ChatMessage {
  return {
    chatId: row.chatId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    metadata: row.metadata,
    parts: row.parts,
    role: row.role,
  };
}

function projectWorkspaceContext(value: unknown): ChatWorkspaceContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultWorkspaceContext();
  const context = value as Record<string, unknown>;
  const activePromptId = typeof context.activePromptId === "string" ? context.activePromptId : null;
  const enabledTools = Array.isArray(context.enabledTools)
    ? context.enabledTools.filter(
        (tool): tool is ChatWorkspaceContext["enabledTools"][number] =>
          typeof tool === "string" && WORKSPACE_TOOL_IDS.has(tool),
      )
    : defaultWorkspaceContext().enabledTools;
  const reasoningEffort =
    context.reasoningEffort === "low" ||
    context.reasoningEffort === "medium" ||
    context.reasoningEffort === "high" ||
    context.reasoningEffort === "xhigh"
      ? context.reasoningEffort
      : "medium";
  return {
    activePromptId,
    enabledTools,
    panelOpen: context.panelOpen === true,
    reasoningEffort,
  };
}

function defaultWorkspaceContext(): ChatWorkspaceContext {
  return {
    activePromptId: null,
    enabledTools: ["prompt-library", "evaluations", "web-search"],
    panelOpen: false,
    reasoningEffort: "medium",
  };
}

function deriveTitle(instruction: string): string {
  const normalized = instruction.trim().replaceAll(/\s+/g, " ");
  if (!normalized) throw new Error("A message is required.");
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}...`;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      !("updatedAt" in parsed) ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.updatedAt))
    ) {
      throw new Error("Invalid cursor.");
    }
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch (error) {
    throw new Error("Invalid chat cursor.", { cause: error });
  }
}
