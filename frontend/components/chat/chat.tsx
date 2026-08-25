/** Owns general chat conversations, safe streaming, detached-run reconciliation, and optional tool selection. */

"use client";

import {
  Bot,
  FlaskConical,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  TriangleAlert,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppIcon } from "@/components/app-icon";
import { Conversation as ConversationView } from "@/components/chat/elements/conversation";
import { FeaturePageHeader } from "@/components/shell/header";
import { ButtonLink } from "@/components/ui/button";
import type {
  Attachment,
  ChatMessage,
  ChatQuote,
  ChatReasoningEffort,
  ChatResponse,
  ChatToolId,
  ConfiguredModel,
  ConfiguredModelsResponse,
  Conversation,
  PromptQuote,
  RunEvent,
  SteerChatResponse,
  StopChatResponse,
  TargetRunQuote,
} from "@/contracts/chat";
import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { createApiRequester, createErrorReader, readResponseError } from "@/shared/api";

import {
  applyAssistantEvent,
  AssistantMessage,
  createAssistantMessage,
  replayAssistantMessage,
} from "./assistant-message";
import { ChatComposer } from "./chat-composer";
import { ChatHistoryIcon } from "./history-icon";
import { summarizeResponseTelemetry } from "./response-telemetry";

const PromptContextPanel = dynamic(() =>
  import("@/components/prompts/context-panel").then(({ PromptContextPanel }) => PromptContextPanel),
);
const TargetWorkspace = dynamic(() =>
  import("./target/workspace").then(({ TargetWorkspace }) => TargetWorkspace),
);

const DEFAULT_TOOLS: ChatToolId[] = ["prompt-library", "evaluations", "web-search"];
const PROMPT_PANEL_MEDIA_QUERY = "(min-width: 800px)";
const chatApi = createApiRequester({ cache: "no-store" });
const readError = createErrorReader("The request failed.");

type WorkspaceDraft = {
  activePromptId: string | null;
  enabledTools: ChatToolId[];
  instruction: string;
  panelOpen: boolean;
  quotes: ChatQuote[];
  reasoningEffort: ChatReasoningEffort;
  selectedModelId: string;
};

type ReplacementSubmission = {
  attachments: Attachment[];
  instruction: string;
  messageId: string;
  quotes: ChatQuote[];
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
  onPromptRevision(reference: PromptRevisionReference): void;
  onQuotesChange(value: ChatQuote[]): void;
  panelOpen: boolean;
  quotes: ChatQuote[];
  reasoningEffort: ChatReasoningEffort;
  selectedModelId: string;
};

type PromptRevisionReference = { promptId: string; revisionId: string };

export function Chat({
  chatId: initialChatId,
  initialPromptId,
  initialTargetRunId,
  initialMode = "agent",
}: {
  chatId?: string;
  initialPromptId?: string;
  initialTargetRunId?: string;
  initialMode?: "agent" | "target";
}) {
  const router = useRouter();
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [enabledTools, setEnabledTools] = useState<ChatToolId[]>(DEFAULT_TOOLS);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(initialPromptId ?? null);
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [highlightedQuote, setHighlightedQuote] = useState<PromptQuote>();
  const [reviewRevision, setReviewRevision] = useState<PromptRevisionReference>();
  const [panelOpen, setPanelOpen] = useState(Boolean(initialPromptId));
  const [panelMounted, setPanelMounted] = useState(Boolean(initialPromptId));
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"agent" | "target">(initialMode);
  const panelWasOpen = useRef(panelOpen);

  const loadPrompts = useCallback(async () => {
    const data = await chatApi.json<PromptsResponse>("/api/prompts");
    setPrompts(data.prompts);
    return data.prompts;
  }, []);
  const handlePromptRevision = useCallback((reference: PromptRevisionReference) => {
    setActivePromptId(reference.promptId);
    setHighlightedQuote(undefined);
    setReviewRevision(reference);
    setPanelOpen(true);
  }, []);
  const handleTargetPromptResolved = useCallback((promptId: string) => {
    setActivePromptId(promptId);
    setPanelOpen(false);
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
    onPromptRevision: handlePromptRevision,
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
  const telemetrySummary = useMemo(() => summarizeResponseTelemetry(messages), [messages]);
  const { containerRef, isAtBottom, onScroll, scrollToBottom } = useScrollToBottom(messages);
  const activePrompt = prompts.find(({ id }) => id === activePromptId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      chatApi.json<ConfiguredModelsResponse>("/api/config"),
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
        const restoredModelId = stored?.selectedModelId ?? chatData?.conversation.chat.modelId;
        setSelectedModelId(
          config.models.find(({ id }) => id === restoredModelId)?.id ?? config.models[0]?.id ?? "",
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

  useEffect(() => {
    if (panelOpen) setPanelMounted(true);
  }, [panelOpen]);

  useEffect(() => {
    const opened = panelOpen && !panelWasOpen.current;
    panelWasOpen.current = panelOpen;
    if (!workspaceReady || !opened) return;
    void loadPrompts().catch((cause) => setError(readError(cause)));
  }, [loadPrompts, panelOpen, setError, workspaceReady]);

  function activatePrompt(prompt: PromptSummary, showPanel: boolean) {
    setActivePromptId(prompt.id);
    setHighlightedQuote(undefined);
    setReviewRevision(undefined);
    window.history.replaceState(
      null,
      "",
      workspaceMode === "target"
        ? `/?mode=target&prompt=${encodeURIComponent(prompt.id)}`
        : chatId
          ? `/chat/${chatId}`
          : showPanel
            ? `/?prompt=${encodeURIComponent(prompt.id)}`
            : "/",
    );
    if (showPanel) setPanelOpen(true);
    setEnabledTools((current) =>
      current.includes("prompt-library") ? current : ["prompt-library", ...current],
    );
  }

  function detachPrompt() {
    setActivePromptId(null);
    setHighlightedQuote(undefined);
    setReviewRevision(undefined);
    window.history.replaceState(null, "", chatId ? `/chat/${chatId}` : "/");
  }

  function switchWorkspaceMode(nextMode: "agent" | "target") {
    setWorkspaceMode(nextMode);
    if (nextMode === "agent") {
      window.history.replaceState(null, "", chatId ? `/chat/${chatId}` : "/");
      return;
    }
    if (!activePromptId) setPanelOpen(true);
    window.history.replaceState(
      null,
      "",
      activePromptId
        ? `/?mode=target&prompt=${encodeURIComponent(activePromptId)}`
        : "/?mode=target",
    );
  }

  function openPromptWorkspace() {
    if (window.matchMedia(PROMPT_PANEL_MEDIA_QUERY).matches) {
      setPanelOpen(true);
      return;
    }
    router.push(activePrompt ? `/prompts/${activePrompt.id}` : "/prompts");
  }

  function addQuote(quote: ChatQuote) {
    if (isPromptQuote(quote)) {
      setActivePromptId(quote.promptId);
      setHighlightedQuote(quote);
    }
    setQuotes((current) => {
      if (current.some((candidate) => sameQuote(candidate, quote))) return current;
      if (current.length >= 6) {
        toast.error("A message can include at most six quotes.");
        return current;
      }
      return [...current, quote];
    });
  }

  function openPromptReference(reference: {
    promptId: string;
    quote?: PromptQuote;
    revisionId?: string;
  }) {
    const prompt = prompts.find(({ id }) => id === reference.promptId);
    if (!prompt) {
      toast.error("The referenced prompt is no longer available.");
      return;
    }
    if (!window.matchMedia(PROMPT_PANEL_MEDIA_QUERY).matches) {
      router.push(`/prompts/${prompt.id}`);
      return;
    }
    setActivePromptId(prompt.id);
    setHighlightedQuote(undefined);
    setReviewRevision(
      reference.revisionId
        ? { promptId: reference.promptId, revisionId: reference.revisionId }
        : undefined,
    );
    if (reference.quote) {
      window.requestAnimationFrame(() => setHighlightedQuote(reference.quote));
    }
    setPanelOpen(true);
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <FeaturePageHeader
        icon={
          workspaceMode === "target" ? (
            <FlaskConical className="size-[18px]" />
          ) : (
            <ChatHistoryIcon
              className="size-[18px]"
              name={conversation?.chat.icon ?? "message-circle"}
            />
          )
        }
        rightContent={
          <div className="flex shrink-0 items-center gap-2">
            <div
              aria-label="Workspace mode"
              className="flex h-8 shrink-0 items-stretch rounded-full border border-border/80"
              role="group"
            >
              <button
                aria-pressed={workspaceMode === "agent"}
                className={`inline-flex items-center gap-1.5 rounded-none px-2.5 text-xs font-medium transition-colors first:rounded-l-full last:rounded-r-full ${workspaceMode === "agent" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => switchWorkspaceMode("agent")}
                type="button"
              >
                <Bot aria-hidden="true" className="size-3.5" /> Agent
              </button>
              <button
                aria-pressed={workspaceMode === "target"}
                className={`inline-flex items-center gap-1.5 rounded-none px-2.5 text-xs font-medium transition-colors first:rounded-l-full last:rounded-r-full ${workspaceMode === "target" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => switchWorkspaceMode("target")}
                type="button"
              >
                <FlaskConical aria-hidden="true" className="size-3.5" /> Target
              </button>
            </div>
            <ButtonLink
              aria-expanded={panelOpen}
              aria-label={
                panelOpen
                  ? "Close prompt editor"
                  : activePrompt
                    ? `Open prompt editor for ${activePrompt.title}`
                    : "Open prompt editor"
              }
              className={`max-w-[min(20rem,45vw)] shrink-0 rounded-full border-border/80 px-2 min-[640px]:px-3 ${panelOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              href={activePrompt ? `/prompts/${activePrompt.id}` : "/prompts"}
              onClick={(event) => {
                if (!window.matchMedia(PROMPT_PANEL_MEDIA_QUERY).matches) return;
                event.preventDefault();
                setPanelOpen((open) => !open);
              }}
              size="sm"
              variant="outline"
            >
              {panelOpen ? (
                <PanelRightClose aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <PanelRightOpen aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              <span className="hidden shrink-0 min-[640px]:inline">Prompt Editor</span>
              {activePrompt ? (
                <span className="hidden truncate text-muted-foreground min-[1120px]:inline">
                  {activePrompt.title}
                </span>
              ) : null}
            </ButtonLink>
          </div>
        }
        title={
          workspaceMode === "target" ? "Target Test" : (conversation?.chat.title ?? "New chat")
        }
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
          {workspaceMode === "target" ? (
            <TargetWorkspace
              activePrompt={activePrompt}
              initialRunId={initialTargetRunId}
              models={models}
              onModelChange={setSelectedModelId}
              onOpenPrompt={openPromptWorkspace}
              onPromptResolved={handleTargetPromptResolved}
              onQuoteInAgent={({ promptId, runId, title }) => {
                setActivePromptId(promptId);
                addQuote({ runId, title });
                switchWorkspaceMode("agent");
              }}
              onReasoningEffortChange={setReasoningEffort}
              reasoningEffort={reasoningEffort}
              selectedModelId={selectedModelId}
            />
          ) : (
            <section
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              aria-label="Agent conversation"
            >
              <ConversationView
                containerRef={containerRef}
                onScroll={onScroll}
                onScrollToBottom={isAtBottom ? undefined : scrollToBottom}
              >
                {messages.length === 0 ? (
                  <EmptyState onSelect={setInstruction} />
                ) : (
                  messages.map((message, index) => {
                    const modelId =
                      typeof message.metadata.modelId === "string"
                        ? message.metadata.modelId
                        : conversation?.chat.modelId;
                    const rerunSource = rerunSources.get(message.id);
                    return (
                      <AssistantMessage
                        continuedByUser={
                          message.role === "user" && messages[index + 1]?.role === "user"
                        }
                        disabled={running}
                        key={message.id}
                        message={message}
                        modelId={modelId}
                        onEdit={message.role === "user" ? editUserMessage : undefined}
                        onPromptReference={openPromptReference}
                        onRerun={rerunSource ? () => rerunFromUserMessage(rerunSource) : undefined}
                        streaming={
                          running && index === messages.length - 1 && message.role === "assistant"
                        }
                      />
                    );
                  })
                )}
                {error ? (
                  <div
                    className="mb-2 flex w-fit max-w-xl items-center gap-1.5 text-xs text-destructive"
                    role="alert"
                  >
                    <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
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
                onOpenPrompt={openPromptWorkspace}
                onPromptChange={(prompt) =>
                  prompt ? activatePrompt(prompt, false) : detachPrompt()
                }
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
                telemetrySummary={telemetrySummary}
              />
            </section>
          )}
          {panelMounted || panelOpen ? (
            <PromptContextPanel
              activePrompt={activePrompt}
              highlightedQuote={highlightedQuote}
              onClose={() => setPanelOpen(false)}
              onPromptUpdated={(prompt) =>
                setPrompts((current) =>
                  current.map((candidate) => (candidate.id === prompt.id ? prompt : candidate)),
                )
              }
              onQuote={addQuote}
              onSelectPrompt={(prompt) => activatePrompt(prompt, true)}
              open={panelOpen}
              prompts={prompts}
              reviewRevision={reviewRevision}
            />
          ) : null}
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
  onPromptRevision,
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

  const loadConversation = useCallback(
    async (id: string) => {
      const data = await chatApi.json<ChatResponse>(`/api/chat?id=${encodeURIComponent(id)}`);
      setConversation(data.conversation);
      setRunning(data.active);
      if (!data.active) {
        setDetached(false);
        setLiveMessage(undefined);
      } else if (ownedRunIdRef.current !== id) {
        setDetached(true);
        setLiveMessage((current) => {
          const replayed = replayAssistantMessage(id, data.conversation.chat.modelId, data.events);
          return current?.chatId === id ? { ...replayed, createdAt: current.createdAt } : replayed;
        });
      }
      const revision = findLatestPromptRevision(data.conversation.messages);
      if (revision) onPromptRevision(revision);
      return data;
    },
    [onPromptRevision],
  );

  useEffect(() => {
    if (!chatId || !detached) return;
    let active = true;
    let polling = false;
    let timer: number | undefined;
    const intervalMs = 1500;
    const schedule = (delay = intervalMs) => {
      if (!active || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };
    const poll = async () => {
      if (polling || document.hidden) return;
      polling = true;
      const startedAt = performance.now();
      try {
        const data = await loadConversation(chatId);
        if (!active) return;
        if (data.active) schedule(Math.max(0, intervalMs - (performance.now() - startedAt)));
        else void onPromptsRefresh().catch((cause) => setError(readError(cause)));
      } catch (cause) {
        if (!active) return;
        setError(readError(cause));
        schedule(Math.max(0, intervalMs - (performance.now() - startedAt)));
      } finally {
        polling = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (polling || timer !== undefined) return;
      void poll();
    };
    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [chatId, detached, loadConversation, onPromptsRefresh]);

  async function submit(replacement?: ReplacementSubmission) {
    if (running) {
      await steer();
      return;
    }
    const requestAttachments = replacement?.attachments ?? attachments;
    const requestQuotes = replacement?.quotes ?? quotes;
    const draftInstruction = replacement?.instruction ?? instruction;
    if (
      (!draftInstruction.trim() && !requestAttachments.length && !requestQuotes.length) ||
      !selectedModelId
    )
      return;
    const requestInstruction =
      draftInstruction.trim() ||
      (requestQuotes.length
        ? requestQuotes.some(isTargetRunQuote)
          ? "Please review the quoted Target Run."
          : "Please review the quoted prompt passage."
        : "Please review the attached files.");
    const runChatId = chatId ?? crypto.randomUUID();
    const optimisticUser: ChatMessage = {
      chatId: runChatId,
      createdAt: new Date().toISOString(),
      id: replacement?.messageId ?? crypto.randomUUID(),
      metadata: {},
      parts: [
        ...requestAttachments.map((attachment) => ({ ...attachment, type: "file" as const })),
        ...requestQuotes.map((quote) =>
          isTargetRunQuote(quote)
            ? { ...quote, type: "target-run-quote" as const }
            : { ...quote, type: "prompt-quote" as const },
        ),
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
    setLiveMessage(createAssistantMessage(runChatId, selectedModelId));
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
      try {
        await loadConversation(runChatId);
      } catch {
        setConversation(conversation);
      }
    }
  }

  async function steer() {
    const runChatId = chatId ?? ownedRunIdRef.current;
    const steeringInstruction = instruction.trim();
    if (!runChatId || !steeringInstruction || !selectedModelId) return;
    const messageId = crypto.randomUUID();
    const optimisticUser: ChatMessage = {
      chatId: runChatId,
      createdAt: new Date().toISOString(),
      id: messageId,
      metadata: { steering: true },
      parts: [{ type: "text", text: steeringInstruction }],
      role: "user",
    };
    setConversation((current) =>
      current ? { ...current, messages: [...current.messages, optimisticUser] } : current,
    );
    onInstructionChange("");
    setError(undefined);
    try {
      await chatApi.json<SteerChatResponse>("/api/chat", {
        body: JSON.stringify({
          chatId: runChatId,
          instruction: steeringInstruction,
          messageId,
          modelId: selectedModelId,
          workspace: { activePromptId, enabledTools, panelOpen, reasoningEffort },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
    } catch (cause) {
      const message = readError(cause);
      setConversation((current) =>
        current
          ? { ...current, messages: current.messages.filter(({ id }) => id !== messageId) }
          : current,
      );
      onInstructionChange(steeringInstruction);
      setError(message);
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
    if (event.type === "prompt-revision") onPromptRevision(event);
    setLiveMessage((current) =>
      applyAssistantEvent(
        current ?? createAssistantMessage(chatId ?? "pending", selectedModelId),
        event,
      ),
    );
  }

  async function stop() {
    if (!chatId) return;
    try {
      await chatApi.json<StopChatResponse>("/api/chat", {
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
        <h2 className="text-xl font-semibold">How Can I Help?</h2>
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
  const quotes = message.parts.flatMap((part): ChatQuote[] => {
    if (part.type === "prompt-quote") {
      const { promptId, revisionId, text, title } = part;
      return [{ promptId, revisionId, text, title }];
    }
    if (part.type === "target-run-quote") {
      const { runId, title } = part;
      return [{ runId, title }];
    }
    return [];
  });
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

function findLatestPromptRevision(messages: ChatMessage[]): PromptRevisionReference | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "prompt-revision") return part;
    }
  }
  return undefined;
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
    const quotes = Array.isArray(value.quotes) ? value.quotes.filter(isChatQuote) : [];
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
  return value === "prompt-library" || value === "evaluations" || value === "web-search";
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

function isTargetRunQuote(value: unknown): value is TargetRunQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const quote = value as Partial<TargetRunQuote>;
  return typeof quote.runId === "string" && typeof quote.title === "string";
}

function isChatQuote(value: unknown): value is ChatQuote {
  return isPromptQuote(value) || isTargetRunQuote(value);
}

function sameQuote(left: ChatQuote, right: ChatQuote): boolean {
  if (isTargetRunQuote(left) || isTargetRunQuote(right)) {
    return isTargetRunQuote(left) && isTargetRunQuote(right) && left.runId === right.runId;
  }
  return (
    left.promptId === right.promptId &&
    left.revisionId === right.revisionId &&
    left.text === right.text
  );
}
