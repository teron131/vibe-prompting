/** Reuses the conversation presentation for prompt-pinned Target Runs while keeping their traces outside general chat history. */

"use client";

import {
  FileText,
  FlaskConical,
  History,
  LoaderCircle,
  MessageSquareQuote,
  Plus,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Conversation as ConversationView } from "@/components/chat/elements/conversation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ChatReasoningEffort, ConfiguredModel } from "@/contracts/chat";
import type { PromptSummary } from "@/contracts/prompts";
import type {
  TargetRun,
  TargetRunEvent,
  TargetRunResponse,
  TargetRunsResponse,
  TargetRunSummary,
} from "@/contracts/target-runs";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { createApiRequester, createErrorReader } from "@/shared/api";

import { AssistantMessage } from "../assistant-message";
import { ChatComposer } from "../chat-composer";
import { projectTargetRunMessages } from "./messages";

const targetApi = createApiRequester({ cache: "no-store" });
const readError = createErrorReader("The Target Run request failed.");
const runDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
});

export function TargetWorkspace({
  activePrompt,
  initialRunId,
  models,
  onModelChange,
  onOpenPrompt,
  onPromptResolved,
  onQuoteInAgent,
  onReasoningEffortChange,
  reasoningEffort,
  selectedModelId,
}: {
  activePrompt?: PromptSummary;
  initialRunId?: string;
  models: ConfiguredModel[];
  onModelChange(modelId: string): void;
  onOpenPrompt(): void;
  onPromptResolved(promptId: string): void;
  onQuoteInAgent(input: { promptId: string; runId: string; title: string }): void;
  onReasoningEffortChange(reasoningEffort: ChatReasoningEffort): void;
  reasoningEffort: ChatReasoningEffort;
  selectedModelId: string;
}) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [run, setRun] = useState<TargetRun>();
  const [runs, setRuns] = useState<TargetRunSummary[]>([]);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<TargetRunEvent[]>([]);
  const [loading, setLoading] = useState(Boolean(initialRunId));
  const [error, setError] = useState<string>();
  const loadRequestRef = useRef(0);

  const loadRun = useCallback(
    async (runId: string) => {
      const requestId = ++loadRequestRef.current;
      const response = await targetApi.json<TargetRunResponse>(
        `/api/target-runs/${encodeURIComponent(runId)}`,
      );
      if (requestId !== loadRequestRef.current) return response;
      setRun(response.run);
      setRunning(response.active);
      setEvents(response.events);
      setError(response.events.find((event) => event.type === "error")?.message);
      onPromptResolved(response.run.promptId);
      onModelChange(response.run.targetModelId);
      onReasoningEffortChange(response.run.reasoningEffort);
      return response;
    },
    [onModelChange, onPromptResolved, onReasoningEffortChange],
  );

  useEffect(() => {
    if (!initialRunId || run?.id === initialRunId) return;
    let active = true;
    setLoading(true);
    void loadRun(initialRunId)
      .catch((cause) => active && setError(readError(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [initialRunId, loadRun, run?.id]);

  useEffect(() => {
    if (!activePrompt) {
      loadRequestRef.current += 1;
      setRuns([]);
      if (!initialRunId) setRun(undefined);
      return;
    }
    if (run?.promptId && run.promptId !== activePrompt.id) {
      loadRequestRef.current += 1;
      setRun(undefined);
      setEvents([]);
      setRunning(false);
    }
    let active = true;
    void targetApi
      .json<TargetRunsResponse>(`/api/target-runs?promptId=${encodeURIComponent(activePrompt.id)}`)
      .then(({ runs: summaries }) => {
        if (!active) return;
        setRuns(summaries);
      })
      .catch((cause) => active && setError(readError(cause)));
    return () => {
      active = false;
    };
  }, [activePrompt?.id, initialRunId, run?.promptId]);

  useEffect(() => {
    if (!run?.id || !running) return;
    const timer = window.setInterval(() => {
      void loadRun(run.id).catch((cause) => setError(readError(cause)));
    }, 750);
    return () => window.clearInterval(timer);
  }, [loadRun, run?.id, running]);

  const messages = useMemo(() => projectTargetRunMessages(run, events), [events, run]);
  const { containerRef, onScroll } = useScrollToBottom(messages);
  const latestCompletedTurn = run?.turns.findLast(({ status }) => status === "completed");

  async function submit() {
    const message = instruction.trim();
    if (!message || !activePrompt || !selectedModelId || running) return;
    setInstruction("");
    setError(undefined);
    setEvents([]);
    setRunning(true);
    try {
      const nextRun = run
        ? await targetApi.json<TargetRun>(`/api/target-runs/${encodeURIComponent(run.id)}`, {
            body: JSON.stringify({ instruction: message }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        : await targetApi.json<TargetRun>("/api/target-runs", {
            body: JSON.stringify({
              instruction: message,
              promptId: activePrompt.id,
              promptRevisionId: activePrompt.revisionId,
              reasoningEffort,
              targetModelId: selectedModelId,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
      setRun(nextRun);
      if (!run) router.replace(`/target-runs/${nextRun.id}`);
    } catch (cause) {
      setInstruction(message);
      setRunning(false);
      setError(readError(cause));
    }
  }

  async function stop() {
    if (!run) return;
    try {
      await targetApi.json(`/api/target-runs/${encodeURIComponent(run.id)}`, { method: "PATCH" });
      await loadRun(run.id);
    } catch (cause) {
      toast.error(readError(cause));
    }
  }

  function startNew() {
    loadRequestRef.current += 1;
    setRun(undefined);
    setEvents([]);
    setRunning(false);
    setError(undefined);
    if (activePrompt) router.replace(`/?mode=target&prompt=${encodeURIComponent(activePrompt.id)}`);
  }

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center">
        <LoaderCircle
          aria-label="Loading Target Run"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <section
      aria-label="Target Test"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {activePrompt ? (
        <>
          <div className="shrink-0 border-b bg-muted/10 px-4 py-2 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {run?.promptTitle ?? activePrompt.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  v{run?.promptRevisionNumber ?? activePrompt.revisionNumber}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                {run ? (
                  <button
                    aria-label="Quote Target Run in Agent"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      onQuoteInAgent({
                        promptId: run.promptId,
                        runId: run.id,
                        title: run.promptTitle,
                      })
                    }
                    type="button"
                  >
                    <MessageSquareQuote aria-hidden="true" className="size-3.5" />
                    <span className="hidden md:inline">Quote in Agent</span>
                  </button>
                ) : null}
                {latestCompletedTurn && run ? (
                  <Link
                    aria-label="Evaluate trace"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    href={`/evaluations/run?targetRun=${encodeURIComponent(run.id)}&targetTurn=${encodeURIComponent(latestCompletedTurn.id)}`}
                  >
                    <FlaskConical aria-hidden="true" className="size-3.5" />
                    <span className="hidden md:inline">Evaluate trace</span>
                  </Link>
                ) : null}
                <button
                  aria-label="Open prompt"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={onOpenPrompt}
                  type="button"
                >
                  <History aria-hidden="true" className="size-3.5" />
                  <span className="hidden sm:inline">Prompt</span>
                </button>
                {runs.length ? (
                  <Select
                    aria-label="Target Run history"
                    className="h-7 w-36 px-2 text-xs shadow-none"
                    onChange={(event) => {
                      if (!event.target.value) {
                        startNew();
                        return;
                      }
                      router.replace(`/target-runs/${event.target.value}`);
                      void loadRun(event.target.value);
                    }}
                    value={run?.id ?? ""}
                  >
                    <option value="">New run</option>
                    {runs.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {formatRunOption(candidate)}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Button
                  className="h-7 shrink-0 px-2.5"
                  disabled={running}
                  onClick={startNew}
                  size="sm"
                  variant="secondary"
                >
                  <Plus aria-hidden="true" className="size-3.5" /> New chat
                </Button>
              </div>
            </div>
          </div>
          <ConversationView containerRef={containerRef} onScroll={onScroll}>
            {messages.length ? (
              messages.map((message, index) => (
                <AssistantMessage
                  disabled={running && index === messages.length - 1}
                  key={message.id}
                  message={message}
                  modelId={run?.targetModelId ?? selectedModelId}
                  onPromptReference={() => undefined}
                />
              ))
            ) : (
              <TargetEmptyState />
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
            attachments={[]}
            enabledTools={[]}
            instruction={instruction}
            models={models}
            onAttachmentsChange={() => undefined}
            onInstructionChange={setInstruction}
            onModelChange={onModelChange}
            onOpenPrompt={onOpenPrompt}
            onPromptChange={() => undefined}
            onQuoteRemove={() => undefined}
            onReasoningEffortChange={onReasoningEffortChange}
            onStop={() => void stop()}
            onSubmit={() => void submit()}
            onToolsChange={() => undefined}
            prompts={[]}
            quotes={[]}
            reasoningEffort={run?.reasoningEffort ?? reasoningEffort}
            running={running}
            selectedModelId={run?.targetModelId ?? selectedModelId}
            targetModelLocked={Boolean(run)}
            variant="target"
          />
        </>
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <FlaskConical aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Select a prompt to test</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Target Runs always pin an exact saved prompt revision before the AI SDK agent
              executes.
            </p>
            <Button className="mt-4" onClick={onOpenPrompt} variant="outline">
              Choose prompt
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function formatRunOption(run: TargetRunSummary): string {
  const turns = `${run.turnCount} ${run.turnCount === 1 ? "turn" : "turns"}`;
  const identity = `${runDateFormatter.format(new Date(run.createdAt))} · ${turns}`;
  return run.latestStatus === "completed" ? identity : `${identity} · ${run.latestStatus}`;
}

function TargetEmptyState() {
  return (
    <div className="grid min-h-[46vh] place-items-center text-center">
      <div className="max-w-xl">
        <FlaskConical aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">Test the selected target</h2>
        <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">
          Start a multi-turn trace against the exact prompt revision shown above. The run is logged
          with the prompt, not with Agent chat history.
        </p>
      </div>
    </div>
  );
}
