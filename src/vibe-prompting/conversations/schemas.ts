/** Owns transport-neutral conversation data and events shared by persistence, workflows, and browser clients without importing SDKs or database code. */

export type ChatToolId = (typeof CHAT_TOOL_IDS)[number];
export type ChatReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type Attachment = { dataUrl: string; mediaType: string; name: string; size: number };
export type ContextQuote = {
  contextId: string;
  revisionId: string;
  text: string;
  title: string;
};
export type TargetRunQuote = { runId: string; title: string };
export type ChatQuote = ContextQuote | TargetRunQuote;
export type ChatWorkspaceContext = {
  activeContextId: string | null;
  enabledTools: ChatToolId[];
  panelOpen: boolean;
  reasoningEffort: ChatReasoningEffort;
};

export type ResponseTelemetry = {
  durationMs: number;
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requests: number | null;
  totalTokens: number | null;
};

export type ChatRequest = {
  attachments: Attachment[];
  chatId: string;
  instruction: string;
  messageId: string;
  modelId: string;
  quotes: ChatQuote[];
  replaceFromMessageId?: string;
  workspace: ChatWorkspaceContext;
};

export type MessagePart =
  | { text: string; type: "text" }
  | (Attachment & { type: "file" })
  | { summary: string; type: "reasoning" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "failed" | "running";
      summary?: string;
      type: "tool";
    }
  | { contextId: string; revisionId: string; type: "context-revision" }
  | (ContextQuote & { type: "context-quote" })
  | (TargetRunQuote & { type: "target-run-quote" })
  | { report: unknown; runId?: string; type: "evaluation" };

export type ChatMessage = {
  chatId: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown>;
  parts: MessagePart[];
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

export type RunEvent =
  | { delta: string; type: "text-delta" }
  | { type: "reasoning-start" }
  | { delta: string; type: "reasoning-delta" }
  | { type: "response-reset" }
  | { startedAt: string; type: "response-start" }
  | { durationMs: number; type: "response-complete" }
  | { chatId: string; icon: string; title: string; type: "chat-metadata" }
  | Extract<MessagePart, { type: "reasoning" | "tool" | "evaluation" | "context-revision" }>
  | { message: string; type: "error" }
  | { type: "stopped" }
  | { type: "finish" };

export type ChatResponse = { active: boolean; conversation: Conversation; events: RunEvent[] };
export type ChatPage = { chats: ChatSummary[]; nextCursor: string | null };
export type ChatSearchResponse = { chats: ChatSummary[] };
export type StopChatResponse = { stopped: boolean };
export type SteerChatResponse = { accepted: true };
export type DeleteChatResponse = { deleted: true };

export type SteerChatRequest = Pick<
  ChatRequest,
  "chatId" | "instruction" | "messageId" | "modelId" | "workspace"
>;

/** Allows clients to observe accepted work without owning its claim; completion resolves after cleanup and failures are delivered as terminal events. */
export type ChatRun = {
  chatId: string;
  completion: Promise<void>;
  subscribe(listener: (event: RunEvent) => void): () => void;
};

export const CHAT_TOOL_IDS = ["context-library", "skills", "evaluations", "web-search"] as const;
