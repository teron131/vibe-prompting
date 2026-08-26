/** Presents one evaluation as a compact selected-turn summary with an on-demand full conversation and score evidence view. */

"use client";

import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  MessagesSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssistantMessage } from "@/components/chat/assistant-message";
import { ResponseText } from "@/components/chat/elements/response";
import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { projectTargetRunMessages } from "@/components/chat/target/messages";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type { ChatMessage } from "@/contracts/chat";
import type { EvaluationResultItem, EvaluationResultScore } from "@/contracts/evaluation-workspace";
import type { EvaluationRunResponse } from "@/contracts/evaluations";
import type { TargetRun, TargetRunResponse } from "@/contracts/target-runs";
import { requestJson } from "@/shared/api";

type TraceMessage = { content: string; role: "assistant" | "user" };

export function evaluationInputPreview(item: EvaluationResultItem): string {
  return (
    projectStoredMessages(item).findLast(({ role }) => role === "user")?.content ??
    stringify(item.input)
  );
}

export function evaluationTurnCount(item: EvaluationResultItem): number {
  return Math.max(1, projectStoredMessages(item).filter(({ role }) => role === "user").length);
}

export function EvaluationTraceViewer({ item }: { item: EvaluationResultItem }) {
  const [expanded, setExpanded] = useState(false);
  const messages = useMemo(() => projectStoredMessages(item), [item]);
  const turnCount = evaluationTurnCount(item);
  const condensed = messages.length > 8;
  const leadingMessages = condensed ? messages.slice(0, 4) : messages;
  const trailingMessages = condensed ? messages.slice(-4) : [];
  const omittedMessageCount = condensed ? messages.length - 8 : 0;

  return (
    <section className="py-4" aria-labelledby={`trace-heading-${item.caseId}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <MessagesSquare aria-hidden="true" className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold" id={`trace-heading-${item.caseId}`}>
              Evaluated Conversation
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {turnCount} {turnCount === 1 ? "turn" : "turns"} · selected response at turn {turnCount}
          </p>
        </div>
        <Button onClick={() => setExpanded(true)} size="sm" variant="outline">
          <Maximize2 aria-hidden="true" className="size-3.5" />
          Open full trace
        </Button>
      </header>

      <div className="mt-3 border-y bg-muted/10">
        <div className="space-y-2 px-3 py-2.5">
          {leadingMessages.map((message, index) => (
            <CompactTraceMessage key={`${message.role}-${index}`} message={message} />
          ))}
          {condensed ? (
            <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span aria-hidden="true">…</span>
              <span className="sr-only">{omittedMessageCount} messages omitted</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}
          {trailingMessages.map((message, index) => (
            <CompactTraceMessage
              key={`${message.role}-${messages.length - 4 + index}`}
              message={message}
            />
          ))}
        </div>
      </div>

      {expanded ? <EvaluationTraceDialog item={item} onClose={() => setExpanded(false)} /> : null}
    </section>
  );
}

function CompactTraceMessage({ message }: { message: TraceMessage }) {
  const user = message.role === "user";
  const preview = compactTracePreview(message.content);
  return (
    <article className={cn("flex min-w-0 gap-3", user ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 max-w-[86%]", user && "text-right")}>
        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">
          {user ? "User" : "AI"}
        </div>
        <div
          className={cn(
            "overflow-hidden rounded-xl px-3 py-1.5 text-left",
            user
              ? "rounded-br-sm bg-[var(--user-bubble-bg)] text-[var(--user-bubble-fg)]"
              : "rounded-bl-sm bg-muted text-foreground",
          )}
        >
          <ResponseText
            className="line-clamp-3 overflow-hidden break-words text-xs! leading-5! [&_.katex-display]:inline! [&_.katex-display]:my-0! [&_p]:m-0! [&_p]:inline"
            compact
            renderImages={false}
            text={preview}
          />
        </div>
      </div>
    </article>
  );
}

function compactTracePreview(content: string): string {
  return stripMarkdownTables(content)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const markdownTableDelimiterPattern =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;

function stripMarkdownTables(content: string): string {
  const lines = content.split("\n");
  const prose: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes("|") && markdownTableDelimiterPattern.test(lines[index + 1] ?? "")) {
      index += 1;
      while (index + 1 < lines.length && lines[index + 1].includes("|")) index += 1;
      continue;
    }
    prose.push(lines[index]);
  }
  return prose.join("\n");
}

function EvaluationTraceDialog({ item, onClose }: { item: EvaluationResultItem; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  const [targetRun, setTargetRun] = useState<TargetRun>();
  const [targetRunTurnId, setTargetRunTurnId] = useState(item.targetRunTurnId);
  const [middleMessagesOpen, setMiddleMessagesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setTargetRun(undefined);
    setTargetRunTurnId(item.targetRunTurnId);
    setMiddleMessagesOpen(false);
    setLoading(true);
    setError(undefined);
    void loadLinkedTargetRun(item)
      .then((linked) => {
        if (!active || !linked) return;
        setTargetRun(linked.run);
        setTargetRunTurnId(linked.targetRunTurnId);
      })
      .catch(
        (cause) =>
          active &&
          setError(
            cause instanceof Error ? cause.message : "The complete Target Run could not be loaded.",
          ),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [item.runId, item.targetRunId, item.targetRunTurnId]);

  useEffect(() => {
    if (!targetRun) return;
    const frame = window.requestAnimationFrame(() => {
      for (const details of conversationRef.current?.querySelectorAll("details") ?? []) {
        details.open = true;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [middleMessagesOpen, targetRun]);

  const messages = targetRun
    ? projectTargetRunMessages(limitRunToEvaluatedTurn(targetRun, targetRunTurnId), [])
    : projectFallbackChatMessages(item);
  const condensed = messages.length > 8;
  const leadingMessages = condensed ? messages.slice(0, 4) : messages;
  const middleMessages = condensed ? messages.slice(4, -4) : [];
  const trailingMessages = condensed ? messages.slice(-4) : [];
  const turnCount = messages.filter(({ role }) => role === "user").length;
  const activityCount = messages
    .flatMap(({ parts }) => parts)
    .filter(({ type }) => type === "tool" || type === "reasoning").length;

  return (
    <dialog
      aria-labelledby={`trace-dialog-title-${item.caseId}`}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-background p-0 text-foreground backdrop:bg-black/60"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        dialogRef.current?.close();
      }}
      ref={dialogRef}
    >
      <div className="flex h-dvh min-h-0 flex-col">
        <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold" id={`trace-dialog-title-${item.caseId}`}>
                  {item.promptTitle} · v{item.promptRevisionNumber}
                </h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {turnCount} {turnCount === 1 ? "turn" : "turns"}
                  {activityCount ? ` · ${activityCount} activities` : ""}
                  {` · ${item.scores.length} score facts`}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Full trace · evaluated turn {turnCount}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-accent"
                href={`/evaluations/${item.runId}`}
              >
                <span className="hidden sm:inline">Run Provenance</span>
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </Link>
              <Button
                aria-label="Close full trace"
                onClick={() => dialogRef.current?.close()}
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:overflow-hidden">
          <section
            aria-label="Conversation trace"
            className="min-h-0 px-4 py-6 sm:px-8 lg:overflow-y-auto lg:px-10"
            ref={conversationRef}
          >
            <div className="mx-auto max-w-3xl">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  Loading complete Target Run
                </div>
              ) : error ? (
                <div
                  className="mb-6 flex items-start gap-2 border-b pb-4 text-sm text-destructive"
                  role="alert"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{error} The persisted evaluation transcript is shown below.</span>
                </div>
              ) : null}
              {!loading ? (
                <>
                  <FullTraceMessages messages={leadingMessages} modelId={item.targetModel} />
                  {condensed ? (
                    <>
                      <button
                        aria-controls={`trace-middle-${item.caseId}`}
                        aria-expanded={middleMessagesOpen}
                        className="group my-5 flex w-full items-center gap-3 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                        onClick={() => setMiddleMessagesOpen((open) => !open)}
                        type="button"
                      >
                        <span className="h-px flex-1 bg-border transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-ring" />
                        <span className="rounded-full border bg-background px-3 py-1.5 font-medium">
                          {middleMessagesOpen ? "Hide" : "Show"} messages 5–
                          {messages.length - 4} · {middleMessages.length} omitted
                        </span>
                        <span className="h-px flex-1 bg-border transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-ring" />
                      </button>
                      <div id={`trace-middle-${item.caseId}`}>
                        {middleMessagesOpen ? (
                          <FullTraceMessages messages={middleMessages} modelId={item.targetModel} />
                        ) : null}
                      </div>
                      <FullTraceMessages messages={trailingMessages} modelId={item.targetModel} />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          <aside
            aria-label="Attributed score evidence"
            className="min-h-0 border-t bg-muted/10 lg:overflow-y-auto lg:border-t-0 lg:border-l"
          >
            <div className="sticky top-0 border-b bg-background/95 px-4 py-3 backdrop-blur-sm">
              <h3 className="text-sm font-semibold">Score Evidence</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Judge facts stay beside the conversation they assess.
              </p>
            </div>
            {item.scores.length ? (
              <div className="divide-y">
                {item.scores.map((score) => (
                  <TraceScore key={score.id} score={score} />
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                No score facts were persisted for this case.
              </p>
            )}
          </aside>
        </div>
      </div>
    </dialog>
  );
}

function FullTraceMessages({ messages, modelId }: { messages: ChatMessage[]; modelId: string }) {
  return messages.map((message) => (
    <AssistantMessage
      disabled
      key={message.id}
      message={message}
      modelId={modelId}
      onPromptReference={ignorePromptReference}
    />
  ));
}

function ignorePromptReference() {}

async function loadLinkedTargetRun(
  item: EvaluationResultItem,
): Promise<{ run: TargetRun; targetRunTurnId: string } | undefined> {
  let targetRunId = item.targetRunId;
  let targetRunTurnId = item.targetRunTurnId;
  if (!targetRunId || !targetRunTurnId) {
    const { run } = await requestJson<EvaluationRunResponse>(
      `/api/evaluations/${encodeURIComponent(item.runId)}`,
    );
    targetRunId = run.targetRunId;
    targetRunTurnId = run.targetRunTurnId;
  }
  if (!targetRunId || !targetRunTurnId) return undefined;
  const { run } = await requestJson<TargetRunResponse>(
    `/api/target-runs/${encodeURIComponent(targetRunId)}`,
  );
  return { run, targetRunTurnId };
}

function TraceScore({ score }: { score: EvaluationResultScore }) {
  const value = formatScore(score.value);
  return (
    <section className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[11px] uppercase text-muted-foreground">
          C{score.criterionPosition + 1} · {score.dataType}
        </div>
        <span className={cn("font-mono text-xs font-semibold", scoreColor(value))}>{value}</span>
      </div>
      <h4 className="mt-1.5 text-sm font-medium leading-5">{score.criterion.name}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{score.criterion.instruction}</p>
      <ModelIdentityLabel
        className="mt-3 text-muted-foreground"
        labelClassName="font-mono text-[11px]"
        modelId={score.judgeModel}
        variant="short-id"
      />
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{score.comment}</p>
      {score.evidence.length ? (
        <details className="group mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            {score.evidence.length} evidence {score.evidence.length === 1 ? "excerpt" : "excerpts"}
          </summary>
          <ul className="mt-2 space-y-2 text-xs leading-5">
            {score.evidence.map((evidence) => (
              <li className="border-l pl-3" key={evidence}>
                {evidence}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function limitRunToEvaluatedTurn(run: TargetRun, targetRunTurnId: string | null): TargetRun {
  const evaluated = run.turns.find(({ id }) => id === targetRunTurnId);
  if (!evaluated) return run;
  const turns = run.turns.filter(({ position }) => position <= evaluated.position);
  return { ...run, turnCount: turns.length, turns };
}

function projectStoredMessages(item: EvaluationResultItem): TraceMessage[] {
  const input = item.input;
  if (isRecord(input) && Array.isArray(input.messages)) {
    const messages = input.messages.flatMap((message) => {
      if (!isRecord(message) || (message.role !== "assistant" && message.role !== "user"))
        return [];
      const content =
        typeof message.content === "string" ? message.content : stringify(message.content);
      return [{ content, role: message.role } satisfies TraceMessage];
    });
    if (messages.length) return appendEvaluatedOutput(messages, item.output);
  }
  return appendEvaluatedOutput([{ content: stringify(input), role: "user" }], item.output);
}

function appendEvaluatedOutput(messages: TraceMessage[], output: unknown): TraceMessage[] {
  if (output === null || output === undefined) return messages;
  const content = stringify(output);
  const last = messages.at(-1);
  return last?.role === "assistant" && last.content === content
    ? messages
    : [...messages, { content, role: "assistant" }];
}

function projectFallbackChatMessages(item: EvaluationResultItem): ChatMessage[] {
  return projectStoredMessages(item).map((message, index) => ({
    chatId: item.runId,
    createdAt: item.createdAt,
    id: `${item.caseId}-fallback-${index}`,
    metadata: {},
    parts: [{ text: message.content, type: "text" }],
    role: message.role,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatScore(value: boolean | number | string): string {
  if (typeof value === "boolean") return value ? "PASS" : "FAIL";
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleUpperCase();
}

function scoreColor(value: string): string {
  const normalized = value.toLocaleLowerCase();
  if (["pass", "good", "true"].includes(normalized))
    return "text-emerald-700 dark:text-emerald-400";
  if (["fail", "bad", "false"].includes(normalized)) return "text-destructive";
  if (["partial", "decent"].includes(normalized)) return "text-amber-700 dark:text-amber-400";
  return "text-foreground";
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "No value persisted.";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
