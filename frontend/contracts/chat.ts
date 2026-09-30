/** Adds transient rendering state to the backend's canonical conversation contracts without importing server runtime code. */
import type {
  ChatMessage as StoredChatMessage,
  ChatResponse as StoredChatResponse,
  Conversation as StoredConversation,
  MessagePart as StoredMessagePart,
} from "vibe-prompting/conversations";
export type {
  Attachment,
  ChatQuote,
  ChatReasoningEffort,
  ChatRequest,
  ChatToolId,
  ChatWorkspaceContext,
  DeleteChatResponse,
  ContextQuote,
  ResponseTelemetry,
  RunEvent,
  SteerChatResponse,
  StopChatResponse,
  TargetRunQuote,
  ChatSummary,
  ChatPage,
  ChatSearchResponse,
} from "vibe-prompting/conversations";
export type MessagePart =
  | Exclude<StoredMessagePart, { type: "reasoning" }>
  | (Extract<StoredMessagePart, { type: "reasoning" }> & { streaming?: boolean });
export type ChatMessage = Omit<StoredChatMessage, "parts"> & { parts: MessagePart[] };
export type Conversation = Omit<StoredConversation, "messages"> & { messages: ChatMessage[] };
export type ChatResponse = Omit<StoredChatResponse, "conversation"> & {
  conversation: Conversation;
};
export type ConfiguredModel = { id: string; known: boolean; label: string; provider: string };
export type ConfiguredModelsResponse = { models: ConfiguredModel[] };
