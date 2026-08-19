/** Owns general chat conversations, safe streaming, detached-run reconciliation, and optional tool selection. */

"use client";

import { FileText, LoaderCircle, PanelRightOpen, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PromptQuote,
  RunEvent,
  StopChatResponse,
} from "@/contracts/chat";
import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";

import { AssistantMessage } from "./assistant-message";
import { ChatComposer } from "./chat-composer";
import { ChatHistoryIcon } from "./history-icon";
import { PromptWorkspace } from "./prompt-workspace";

const DEFAULT_TOOLS: ChatToolId[] = ["prompt-library", "evaluations", "web-search"];

type WorkspaceDraft = {
  activePromptId: string | null;
  enabledTools: ChatToolId[];
  instruction: string;
  panelOpen: boolean;
  quotes: PromptQuote[];
  reasoningEffort: ChatReasoningEffort;
  selectedModelId: string;
};

type ReplacementSubmission = {
  attachments: Attachment[];
  instruction: string;
  messageId: string;
  quotes: PromptQuote[];
};

type UseChatRunInput = {
  activePromptId: string | null;
  attachments: Attachment[];
  enabledTools: ChatToolId[];
  initialChatId?: string;
  instruction: string;
  onAttachmentsChange(value: Attachment[]): void;
  onInstructionChange(value: string): void;
  onPromptsRefresh(): Promise<unknown>;
  onQuotesChange(value: PromptQuote[]): void;
  panelOpen: boolean;
  quotes: PromptQuote[];
  reasoningEffort: ChatReasoningEffort;
  selectedModelId: string;
};

export function Chat({
  chatId: initialChatId,
  initialPromptId,
}: {
  chatId?: string;
  initialPromptId?: string;
}) {
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [enabledTools, setEnabledTools] = useState<ChatToolId[]>(DEFAULT_TOOLS);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(initialPromptId ?? null);
  const [quotes, setQuotes] = useState<PromptQuote[]>([]);
  const [highlightedQuote, setHighlightedQuote] = useState<PromptQuote>();
  const [panelOpen, setPanelOpen] = useState(Boolean(initialPromptId));
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const loadPrompts = useCallback(async () => {
    const data = await fetchJson<PromptsResponse>("/api/prompts");
    setPrompts(data.prompts);
    return data.prompts;
  }, []);

  const {
    chatId,
    conversation,
    editUserMessage,
    error,
    loadConversation,
    messages,
    rerunFromUserMessage,
    running,
    setError,
    stop,
    submit,
  } = useChatRun({
    activePromptId,
    attachments,
    enabledTools,
    initialChatId,
    instruction,
    onAttachmentsChange: setAttachments,
    onInstructionChange: setInstruction,
    onPromptsRefresh: loadPrompts,
    onQuotesChange: setQuotes,
    panelOpen,
    quotes,
    reasoningEffort,
    selectedModelId,
  });
  const rerunSources = useMemo(() => {
    const sources = new Map<string, ChatMessage>();
    let latestUser: ChatMessage | undefined;
    for (const message of messages) {
      if (message.role === "user") latestUser = message;
      else if (latestUser) sources.set(message.id, latestUser);
    }
    return sources;
  }, [messages]);
  const { containerRef, onScroll } = useScrollToBottom(messages);
  const activePrompt = prompts.find(({ id }) => id === activePromptId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchJson<ConfiguredModelsResponse>("/api/config"),
      loadPrompts(),
      chatId ? loadConversation(chatId) : Promise.resolve(undefined),
    ])
      .then(([config, promptList, chatData]) => {
        if (!active) return;
        setModels(config.models);
        const stored = readWorkspaceDraft(workspaceStorageKey(chatId));
        const context = chatData?.conversation.context;
        const requestedPrompt = initialPromptId
          ? promptList.find(({ id }) => id === initialPromptId)
          : undefined;
        const restoredPrompt = promptList.find(
          ({ id }) => id === (stored?.activePromptId ?? context?.activePromptId),
        );
        setActivePromptId(requestedPrompt?.id ?? restoredPrompt?.id ?? null);
        setEnabledTools(stored?.enabledTools ?? context?.enabledTools ?? DEFAULT_TOOLS);
        setInstruction(stored?.instruction ?? "");
        setPanelOpen(requestedPrompt ? true : (stored?.panelOpen ?? context?.panelOpen ?? false));
        setQuotes(stored?.quotes ?? []);
        setReasoningEffort(stored?.reasoningEffort ?? context?.reasoningEffort ?? "medium");
        setSelectedModelId(
          stored?.selectedModelId ??
            chatData?.conversation.chat.modelId ??
            config.models[0]?.id ??
            "",
        );
        if (initialPromptId && !requestedPrompt) setError("The requested prompt was not found.");
        setWorkspaceReady(true);
      })
      .catch((cause) => active && setError(readError(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [chatId, initialPromptId, loadConversation, loadPrompts]);

  useEffect(() => {
    if (!workspaceReady) return;
    const draft: WorkspaceDraft = {
      activePromptId,
      enabledTools,
      instruction,
      panelOpen,
      quotes,
      reasoningEffort,
      selectedModelId,
    };
    window.localStorage.setItem(workspaceStorageKey(chatId), JSON.stringify(draft));
  }, [
    activePromptId,
    chatId,
    enabledTools,
    instruction,
    panelOpen,
    quotes,
    reasoningEffort,
    selectedModelId,
    workspaceReady,
  ]);

  function activatePrompt(prompt: PromptSummary, showPanel: boolean) {
    setActivePromptId(prompt.id);
    setHighlightedQuote(undefined);
    window.history.replaceState(
      null,
      "",
      chatId ? `/chat/${chatId}` : showPanel ? `/?prompt=${encodeURIComponent(prompt.id)}` : "/",
    );
    if (showPanel) setPanelOpen(true);
    setEnabledTools((current) =>
      current.includes("prompt-library") ? current : ["prompt-library", ...current],
    );
  }

  function detachPrompt() {
    setActivePromptId(null);
    setHighlightedQuote(undefined);
    window.history.replaceState(null, "", chatId ? `/chat/${chatId}` : "/");
  }

  function addQuote(quote: PromptQuote) {
    setActivePromptId(quote.promptId);
    setHighlightedQuote(quote);
    setQuotes((current) => {
      if (
        current.some(
          (candidate) =>
            candidate.promptId === quote.promptId &&
            candidate.revisionId === quote.revisionId &&
            candidate.text === quote.text,
        )
      ) {
        return current;
      }
      if (current.length >= 6) {
        toast.error("A message can include at most six prompt quotes.");
        return current;
      }
      return [...current, quote];
    });
  }

  function openPromptReference(reference: { promptId: string; quote?: PromptQuote }) {
    const prompt = prompts.find(({ id }) => id === reference.promptId);
    if (!prompt) {
      toast.error("The referenced prompt is no longer available.");
      return;
    }
    setActivePromptId(prompt.id);
    setHighlightedQuote(undefined);
    if (reference.quote) {
      window.requestAnimationFrame(() => setHighlightedQuote(reference.quote));
    }
    setPanelOpen(true);
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
        rightContent={
          <button
            aria-label={activePrompt ? `Open ${activePrompt.title}` : "Open prompt workspace"}
            className="inline-flex h-8 max-w-[min(18rem,45vw)] items-center gap-2 rounded-md border px-2.5 text-xs font-medium hover:bg-accent"
            onClick={() => setPanelOpen(true)}
            type="button"
          >
            <FileText aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{activePrompt?.title ?? "Prompt"}</span>
            <PanelRightOpen
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </button>
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
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col" aria-label="Agent conversation">
            <ConversationView containerRef={containerRef} onScroll={onScroll}>
              {messages.length === 0 ? (
                <EmptyState onSelect={setInstruction} />
              ) : (
                messages.map((message) => {
                  const modelId =
                    typeof message.metadata.modelId === "string"
                      ? message.metadata.modelId
                      : undefined;
                  const rerunSource = rerunSources.get(message.id);
                  return (
                    <AssistantMessage
                      disabled={running}
                      key={message.id}
                      message={message}
                      model={models.find((model) => model.id === modelId)}
                      onEdit={message.role === "user" ? editUserMessage : undefined}
                      onPromptReference={openPromptReference}
                      onRerun={rerunSource ? () => rerunFromUserMessage(rerunSource) : undefined}
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
              activePrompt={activePrompt}
              attachments={attachments}
              enabledTools={enabledTools}
              instruction={instruction}
              models={models}
              onAttachmentsChange={setAttachments}
              onInstructionChange={setInstruction}
              onModelChange={setSelectedModelId}
              onOpenPrompt={() => setPanelOpen(true)}
              onPromptChange={(prompt) => (prompt ? activatePrompt(prompt, false) : detachPrompt())}
              onQuoteRemove={(quote) =>
                setQuotes((current) => current.filter((candidate) => candidate !== quote))
              }
              onReasoningEffortChange={setReasoningEffort}
              onStop={stop}
              onSubmit={() => void submit()}
              onToolsChange={setEnabledTools}
              prompts={prompts}
              quotes={quotes}
              reasoningEffort={reasoningEffort}
              running={running}
              selectedModelId={selectedModelId}
            />
          </section>
          <PromptWorkspace
            activePrompt={activePrompt}
            highlightedQuote={highlightedQuote}
            onClose={() => setPanelOpen(false)}
            onQuote={addQuote}
            onSelectPrompt={(prompt) => activatePrompt(prompt, true)}
            open={panelOpen}
            prompts={prompts}
          />
        </div>
      )}
    </main>
  );
}

function useChatRun({
  activePromptId,
  attachments,
  enabledTools,
  initialChatId,
  instruction,
  onAttachmentsChange,
  onInstructionChange,
  onPromptsRefresh,
  onQuotesChange,
  panelOpen,
  quotes,
  reasoningEffort,
  selectedModelId,
}: UseChatRunInput) {
  const router = useRouter();
  const [chatId, setChatId] = useState(initialChatId);
  const [conversation, setConversation] = useState<Conversation>();
  const [liveMessage, setLiveMessage] = useState<ChatMessage>();
  const [running, setRunning] = useState(false);
  const [detached, setDetached] = useState(false);
  const [error, setError] = useState<string>();
  const ownedRunIdRef = useRef<string | undefined>(undefined);
  const messages = useMemo(
    () => [...(conversation?.messages ?? []), ...(liveMessage ? [liveMessage] : [])],
    [conversation, liveMessage],
  );

  const loadConversation = useCallback(async (id: string) => {
    const data = await fetchJson<ChatResponse>(`/api/chat?id=${encodeURIComponent(id)}`);
    setConversation(data.conversation);
    setRunning(data.active);
    if (!data.active) {
      setDetached(false);
      setLiveMessage(undefined);
    } else if (ownedRunIdRef.current !== id) {
      setDetached(true);
      setLiveMessage(replayLiveMessage(id, data.conversation.chat.modelId, data.events));
    }
    return data;
  }, []);

  useEffect(() => {
    if (!chatId || !detached) return;
    const timer = window.setInterval(() => {
      void loadConversation(chatId)
        .then((data) => {
          if (!data.active) {
            window.clearInterval(timer);
            void onPromptsRefresh().catch((cause) => setError(readError(cause)));
          }
        })
        .catch((cause) => setError(readError(cause)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [chatId, detached, loadConversation, onPromptsRefresh]);

  async function submit(replacement?: ReplacementSubmission) {
    const requestAttachments = replacement?.attachments ?? attachments;
    const requestQuotes = replacement?.quotes ?? quotes;
    const draftInstruction = replacement?.instruction ?? instruction;
    if (
      running ||
      (!draftInstruction.trim() && !requestAttachments.length && !requestQuotes.length) ||
      !selectedModelId
    )
      return;
    const requestInstruction =
      draftInstruction.trim() ||
      (requestQuotes.length
        ? "Please review the quoted prompt passage."
        : "Please review the attached files.");
    const runChatId = chatId ?? crypto.randomUUID();
    const optimisticUser: ChatMessage = {
      chatId: runChatId,
      createdAt: new Date().toISOString(),
      id: replacement?.messageId ?? crypto.randomUUID(),
      metadata: {},
      parts: [
        ...requestAttachments.map((attachment) => ({ ...attachment, type: "file" as const })),
        ...requestQuotes.map((quote) => ({ ...quote, type: "prompt-quote" as const })),
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
      context: { activePromptId, enabledTools, panelOpen, reasoningEffort },
      messages: [],
    };
    const replacementIndex = replacement
      ? baseConversation.messages.findIndex(({ id }) => id === replacement.messageId)
      : -1;
    if (replacement && replacementIndex < 0) {
      toast.error("That message is no longer available to replace.");
      return;
    }
    const retainedMessages = replacement
      ? baseConversation.messages.slice(0, replacementIndex)
      : baseConversation.messages;
    setConversation({ ...baseConversation, messages: [...retainedMessages, optimisticUser] });
    if (!replacement) {
      onInstructionChange("");
      onAttachmentsChange([]);
      onQuotesChange([]);
    }
    setError(undefined);
    setRunning(true);
    setDetached(false);
    setLiveMessage(createLiveMessage(runChatId, selectedModelId));
    ownedRunIdRef.current = runChatId;

    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({
          attachments: requestAttachments,
          chatId: runChatId,
          instruction: requestInstruction,
          messageId: optimisticUser.id,
          modelId: selectedModelId,
          quotes: requestQuotes,
          replaceFromMessageId: replacement?.messageId,
          workspace: { activePromptId, enabledTools, panelOpen, reasoningEffort },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      if (!chatId) {
        window.localStorage.removeItem(workspaceStorageKey(undefined));
        setChatId(runChatId);
        window.history.replaceState(null, "", `/chat/${runChatId}`);
      }
      window.dispatchEvent(new Event("vibe:history"));
      await consumeRunStream(response, applyRunEvent);
      ownedRunIdRef.current = undefined;
      await loadConversation(runChatId);
      try {
        await onPromptsRefresh();
      } catch (cause) {
        toast.error(`The prompt workspace could not refresh: ${readError(cause)}`);
      }
      setLiveMessage(undefined);
      setRunning(false);
      setDetached(false);
      router.replace(`/chat/${runChatId}`);
      router.refresh();
      window.dispatchEvent(new Event("vibe:history"));
    } catch (cause) {
      ownedRunIdRef.current = undefined;
      const message = readError(cause);
      setError(message);
      setRunning(false);
      setDetached(false);
      setLiveMessage(undefined);
      if (!replacement) {
        onInstructionChange(draftInstruction);
        onAttachmentsChange(requestAttachments);
        onQuotesChange(requestQuotes);
      }
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
          ? { ...current, chat: { ...current.chat, icon: event.icon, title: event.title } }
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
      ownedRunIdRef.current = undefined;
      setDetached(true);
    } catch (cause) {
      toast.error(readError(cause));
    }
  }

  return {
    chatId,
    conversation,
    editUserMessage(message: ChatMessage, text: string) {
      void submit(createReplacementSubmission(message, text));
    },
    error,
    loadConversation,
    messages,
    rerunFromUserMessage(message: ChatMessage) {
      void submit(createReplacementSubmission(message));
    },
    running,
    setError,
    stop,
    submit,
  };
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

function createReplacementSubmission(
  message: ChatMessage,
  editedText?: string,
): ReplacementSubmission {
  const attachments = message.parts
    .filter((part) => part.type === "file")
    .map(({ dataUrl, mediaType, name, size }) => ({ dataUrl, mediaType, name, size }));
  const quotes = message.parts
    .filter((part) => part.type === "prompt-quote")
    .map(({ promptId, revisionId, text, title }) => ({ promptId, revisionId, text, title }));
  const instruction =
    editedText ??
    message.parts
      .filter((part) => part.type === "text")
      .map(({ text }) => text)
      .join("\n");
  return {
    attachments,
    instruction,
    messageId: message.id,
    quotes,
  };
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
  if (event.type === "reasoning-start") {
    if (message.parts.some((part) => part.type === "reasoning" && part.streaming)) return message;
    return {
      ...message,
      parts: [...message.parts, { streaming: true, summary: "", type: "reasoning" }],
    };
  }
  if (event.type === "reasoning-delta") {
    const parts = [...message.parts];
    const streamingIndex = parts.findLastIndex(
      (part) => part.type === "reasoning" && part.streaming,
    );
    if (streamingIndex >= 0) {
      const existing = parts[streamingIndex];
      if (existing.type === "reasoning") {
        parts[streamingIndex] = { ...existing, summary: existing.summary + event.delta };
      }
    } else {
      parts.push({ streaming: true, summary: event.delta, type: "reasoning" });
    }
    return { ...message, parts };
  }
  if (event.type === "reasoning") {
    const parts = [...message.parts];
    const streamingIndex = parts.findLastIndex(
      (part) => part.type === "reasoning" && part.streaming,
    );
    if (streamingIndex >= 0) parts[streamingIndex] = event;
    else {
      const textIndex = parts.findIndex((part) => part.type === "text");
      parts.splice(textIndex >= 0 ? textIndex : parts.length, 0, event);
    }
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

function replayLiveMessage(chatId: string, modelId: string, events: RunEvent[]): ChatMessage {
  return events.reduce(
    (message, event) => {
      if (
        event.type === "chat-metadata" ||
        event.type === "error" ||
        event.type === "finish" ||
        event.type === "stopped"
      ) {
        return message;
      }
      return addLiveEvent(message, event);
    },
    createLiveMessage(chatId, modelId),
  );
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
  } catch {}
  return `Request failed with status ${response.status}.`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

function workspaceStorageKey(chatId: string | undefined): string {
  return `vibe-prompting:workspace:${chatId ?? "new"}`;
}

function readWorkspaceDraft(key: string): WorkspaceDraft | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<WorkspaceDraft>;
    const tools = Array.isArray(value.enabledTools)
      ? value.enabledTools.filter(isChatToolId)
      : DEFAULT_TOOLS;
    const quotes = Array.isArray(value.quotes) ? value.quotes.filter(isPromptQuote) : [];
    return {
      activePromptId: typeof value.activePromptId === "string" ? value.activePromptId : null,
      enabledTools: tools,
      instruction: typeof value.instruction === "string" ? value.instruction : "",
      panelOpen: value.panelOpen === true,
      quotes,
      reasoningEffort: isReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : "medium",
      selectedModelId: typeof value.selectedModelId === "string" ? value.selectedModelId : "",
    };
  } catch {
    return undefined;
  }
}

function isChatToolId(value: unknown): value is ChatToolId {
  return value === "evaluations" || value === "prompt-library" || value === "web-search";
}

function isReasoningEffort(value: unknown): value is ChatReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isPromptQuote(value: unknown): value is PromptQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const quote = value as Partial<PromptQuote>;
  return (
    typeof quote.promptId === "string" &&
    typeof quote.revisionId === "string" &&
    typeof quote.text === "string" &&
    typeof quote.title === "string"
  );
}
