/** Owns browser-safe chat request, response, persistence, and streaming shapes shared by routes and components. */

export type ConfiguredModel = { id: string; label: string; provider: string };

export type ChatToolId = "evaluations" | "prompt-library" | "web-search";
export type ChatReasoningEffort = "high" | "low" | "medium" | "xhigh";
export type Attachment = { dataUrl: string; mediaType: string; name: string; size: number };

export type ChatRequest = {
  attachments: Attachment[];
  chatId: string;
  enabledTools: ChatToolId[];
  instruction: string;
  modelId: string;
  reasoningEffort: ChatReasoningEffort;
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
  | { promptId: string; revisionId: string; type: "prompt-revision" }
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

export type Conversation = { chat: ChatSummary; messages: ChatMessage[] };

export type RunEvent =
  | { delta: string; type: "text-delta" }
  | { chatId: string; icon: string; title: string; type: "chat-metadata" }
  | Extract<MessagePart, { type: "reasoning" | "tool" | "evaluation" | "prompt-revision" }>
  | { message: string; type: "error" }
  | { type: "stopped" }
  | { type: "finish" };

export type ChatResponse = { active: boolean; conversation: Conversation };
export type ChatPage = { chats: ChatSummary[]; nextCursor: string | null };
export type ChatSearchResponse = { chats: ChatSummary[] };
export type ConfiguredModelsResponse = { models: ConfiguredModel[] };
export type StopChatResponse = { stopped: boolean };
export type DeleteChatResponse = { deleted: true };
