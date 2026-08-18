/** Owns general chat conversations, safe streaming, detached-run reconciliation, and optional tool selection. */

"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppIcon } from "@/components/app-icon";
import { Conversation as ConversationView } from "@/components/chat/elements/conversation";
import { FeaturePageHeader } from "@/components/shell/header";
import type {
  Attachment,
  ChatMessage,
  ChatReasoningEffort,
  ChatResponse,
  ChatToolId,
  ConfiguredModel,
  ConfiguredModelsResponse,
  Conversation,
  RunEvent,
  StopChatResponse,
} from "@/contracts/chat";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";

import { AssistantMessage } from "./assistant-message";
import { ChatComposer } from "./chat-composer";
import { ChatHistoryIcon } from "./history-icon";

const DEFAULT_TOOLS: ChatToolId[] = ["prompt-library", "evaluations", "web-search"];

export function Chat({ chatId: initialChatId }: { chatId?: string }) {
  const router = useRouter();
  const [chatId, setChatId] = useState(initialChatId);
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [conversation, setConversation] = useState<Conversation>();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [enabledTools, setEnabledTools] = useState<ChatToolId[]>(DEFAULT_TOOLS);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [instruction, setInstruction] = useState("");
  const [liveMessage, setLiveMessage] = useState<ChatMessage>();
  const [running, setRunning] = useState(false);
  const [detached, setDetached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const messages = useMemo(
    () => [...(conversation?.messages ?? []), ...(liveMessage ? [liveMessage] : [])],
    [conversation, liveMessage],
  );
  const { containerRef, onScroll } = useScrollToBottom(messages);

  const loadConversation = useCallback(async (id: string) => {
    const data = await fetchJson<ChatResponse>(`/api/chat?id=${encodeURIComponent(id)}`);
    setConversation(data.conversation);
    setSelectedModelId(data.conversation.chat.modelId);
    setRunning(data.active);
    setDetached(data.active);
    return data.active;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchJson<ConfiguredModelsResponse>("/api/config"),
      chatId ? loadConversation(chatId) : Promise.resolve(false),
    ])
      .then(([config]) => {
        if (!active) return;
        setModels(config.models);
        if (!chatId) setSelectedModelId((current) => current || config.models[0]?.id || "");
      })
      .catch((cause) => active && setError(readError(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [chatId, loadConversation]);

  useEffect(() => {
    if (!chatId || !detached) return;
    const timer = window.setInterval(() => {
      void loadConversation(chatId)
        .then((active) => {
          if (!active) {
            setDetached(false);
            setLiveMessage(undefined);
            window.clearInterval(timer);
          }
        })
        .catch((cause) => setError(readError(cause)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [chatId, detached, loadConversation]);

  async function submit() {
    if (running || (!instruction.trim() && !attachments.length) || !selectedModelId) return;
    const requestInstruction = instruction.trim() || "Please review the attached files.";
    const requestAttachments = attachments;
    const runChatId = chatId ?? crypto.randomUUID();
    const optimisticUser: ChatMessage = {
      chatId: runChatId,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      metadata: {},
      parts: [
        ...requestAttachments.map((attachment) => ({ ...attachment, type: "file" as const })),
        { type: "text", text: requestInstruction },
      ],
      role: "user",
    };
    const baseConversation: Conversation = conversation ?? {
      chat: {
        createdAt: optimisticUser.createdAt,
        icon: "message-circle",
        id: runChatId,
        modelId: selectedModelId,
        title: requestInstruction.slice(0, 72),
        updatedAt: optimisticUser.createdAt,
      },
      messages: [],
    };
    setConversation({
      ...baseConversation,
      messages: [...baseConversation.messages, optimisticUser],
    });
    setInstruction("");
    setAttachments([]);
    setError(undefined);
    setRunning(true);
    setDetached(false);
    setLiveMessage(createLiveMessage(runChatId, selectedModelId));

    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({
          attachments: requestAttachments,
          chatId: runChatId,
          enabledTools,
          instruction: requestInstruction,
          modelId: selectedModelId,
          reasoningEffort,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      if (!chatId) {
        setChatId(runChatId);
        window.history.replaceState(null, "", `/chat/${runChatId}`);
      }
      window.dispatchEvent(new Event("vibe:history"));
      await consumeRunStream(response, applyRunEvent);
      await loadConversation(runChatId);
      setLiveMessage(undefined);
      setRunning(false);
      setDetached(false);
      router.replace(`/chat/${runChatId}`);
      router.refresh();
      window.dispatchEvent(new Event("vibe:history"));
    } catch (cause) {
      const message = readError(cause);
      setError(message);
      setRunning(false);
      setDetached(false);
      setLiveMessage(undefined);
      toast.error(message);
      try {
        await loadConversation(runChatId);
      } catch {
        setConversation(conversation);
      }
    }
  }

  function applyRunEvent(event: RunEvent) {
    if (event.type === "finish") return;
    if (event.type === "stopped") {
      setRunning(false);
      return;
    }
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "chat-metadata") {
      setConversation((current) =>
        current && current.chat.id === event.chatId
          ? {
              ...current,
              chat: { ...current.chat, icon: event.icon, title: event.title },
            }
          : current,
      );
      window.dispatchEvent(new Event("vibe:history"));
      return;
    }
    setLiveMessage((current) =>
      addLiveEvent(current ?? createLiveMessage(chatId ?? "pending", selectedModelId), event),
    );
  }

  async function stop() {
    if (!chatId) return;
    try {
      await fetchJson<StopChatResponse>("/api/chat", {
        body: JSON.stringify({ chatId }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      setDetached(true);
    } catch (cause) {
      toast.error(readError(cause));
    }
  }

  return (
    <main className="flex h-screen min-h-0 flex-col">
      <FeaturePageHeader
        icon={
          <ChatHistoryIcon
            className="size-[18px]"
            name={conversation?.chat.icon ?? "message-circle"}
          />
        }
        title={conversation?.chat.title ?? "New chat"}
      />
      {loading ? (
        <div className="grid flex-1 place-items-center">
          <LoaderCircle
            aria-label="Loading chat"
            className="size-5 animate-spin text-muted-foreground"
          />
        </div>
      ) : (
        <>
          <ConversationView containerRef={containerRef} onScroll={onScroll}>
            {messages.length === 0 ? (
              <EmptyState onSelect={setInstruction} />
            ) : (
              messages.map((message) => {
                const modelId =
                  typeof message.metadata.modelId === "string"
                    ? message.metadata.modelId
                    : undefined;
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    model={models.find((model) => model.id === modelId)}
                  />
                );
              })
            )}
            {error ? (
              <div className="mb-5 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            ) : null}
          </ConversationView>
          <ChatComposer
            attachments={attachments}
            enabledTools={enabledTools}
            instruction={instruction}
            models={models}
            onAttachmentsChange={setAttachments}
            onInstructionChange={setInstruction}
            onModelChange={setSelectedModelId}
            onReasoningEffortChange={setReasoningEffort}
            onStop={stop}
            onSubmit={submit}
            onToolsChange={setEnabledTools}
            reasoningEffort={reasoningEffort}
            running={running}
            selectedModelId={selectedModelId}
          />
        </>
      )}
    </main>
  );
}

function EmptyState({ onSelect }: { onSelect(value: string): void }) {
  const description =
    "Brainstorm possibilities, sharpen a prompt, or diagnose exactly what is not working.";
  const suggestions = ["Explore an idea", "Sharpen a prompt", "Diagnose a problem"];
  return (
    <div className="grid min-h-[46vh] place-items-center text-center">
      <div className="max-w-xl">
        <div className="mx-auto mb-4 grid size-12 place-items-center">
          <AppIcon className="size-7" />
        </div>
        <h2 className="text-xl font-semibold">How can I help?</h2>
        <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
              key={suggestion}
              onClick={() => onSelect(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function createLiveMessage(chatId: string, modelId?: string): ChatMessage {
  return {
    chatId,
    createdAt: new Date().toISOString(),
    id: "live-assistant",
    metadata: modelId ? { modelId } : {},
    parts: [],
    role: "assistant",
  };
}

function addLiveEvent(
  message: ChatMessage,
  event: Exclude<RunEvent, { type: "chat-metadata" | "error" | "finish" | "stopped" }>,
): ChatMessage {
  if (event.type === "text-delta") {
    const parts = [...message.parts];
    const last = parts.at(-1);
    if (last?.type === "text")
      parts[parts.length - 1] = { type: "text", text: last.text + event.delta };
    else parts.push({ type: "text", text: event.delta });
    return { ...message, parts };
  }
  if (event.type === "tool") {
    const existingIndex = message.parts.findIndex(
      (part) => part.type === "tool" && part.callId === event.callId,
    );
    const parts = [...message.parts];
    if (existingIndex >= 0) parts[existingIndex] = { ...parts[existingIndex], ...event };
    else parts.push(event);
    return { ...message, parts };
  }
  return { ...message, parts: [...message.parts, event] };
}

async function consumeRunStream(
  response: Response,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("The response stream was unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line) onEvent(JSON.parse(line) as RunEvent);
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as RunEvent);
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(await readResponseError(response));
  return (await response.json()) as T;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as { error?: unknown };
    if (typeof value.error === "string") return value.error;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
  return `Request failed with status ${response.status}.`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}
