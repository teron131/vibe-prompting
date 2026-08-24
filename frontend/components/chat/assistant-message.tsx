/** Reconstructs persisted and live assistant messages with copy actions and optional prompt or evaluation artifacts. */

"use client";

import {
  BarChart3,
  Brain,
  Check,
  ChevronRight,
  Copy,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  LoaderCircle,
  Pencil,
  Quote,
  RefreshCcw,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Message } from "@/components/chat/elements/message";
import { Reasoning } from "@/components/chat/elements/reasoning";
import { ResponseText } from "@/components/chat/elements/response";
import { Tool } from "@/components/chat/elements/tool";
import { cn } from "@/components/ui/utils";
import type { ChatMessage, MessagePart, ResponseTelemetry, RunEvent } from "@/contracts/chat";

import { ModelIcon } from "./model-selector";
import {
  readResponseTelemetry,
  ResponseElapsedTime,
  ResponseTelemetryLine,
} from "./response-telemetry";

type PromptReference = {
  promptId: string;
  quote?: Extract<MessagePart, { type: "prompt-quote" }>;
  revisionId?: string;
};

type AssistantEvent = Exclude<RunEvent, { type: "chat-metadata" | "error" | "finish" | "stopped" }>;

export function createAssistantMessage(chatId: string, modelId?: string): ChatMessage {
  return {
    chatId,
    createdAt: new Date().toISOString(),
    id: "live-assistant",
    metadata: modelId ? { modelId } : {},
    parts: [],
    role: "assistant",
  };
}

export function applyAssistantEvent(message: ChatMessage, event: AssistantEvent): ChatMessage {
  if (event.type === "response-start") {
    return {
      ...message,
      metadata: { ...message.metadata, responseStartedAt: event.startedAt },
    };
  }
  if (event.type === "response-complete") {
    return {
      ...message,
      metadata: { ...message.metadata, responseDurationMs: event.durationMs },
    };
  }
  if (event.type === "text-delta") {
    const parts = [...message.parts];
    const last = parts.at(-1);
    if (last?.type === "text")
      parts[parts.length - 1] = { type: "text", text: last.text + event.delta };
    else parts.push({ type: "text", text: event.delta });
    return { ...message, parts };
  }
  if (event.type === "response-reset") {
    return {
      ...message,
      parts: message.parts.filter((part) => part.type !== "reasoning" && part.type !== "text"),
    };
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
    else parts.push(event);
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

export function replayAssistantMessage(
  chatId: string,
  modelId: string,
  events: RunEvent[],
): ChatMessage {
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
      return applyAssistantEvent(message, event);
    },
    createAssistantMessage(chatId, modelId),
  );
}

export function projectAssistantParts(events: RunEvent[]): MessagePart[] {
  return replayAssistantMessage("live", "", events).parts;
}

export function AssistantMessage({
  continuedByUser = false,
  disabled,
  message,
  modelId,
  onEdit,
  onPromptReference,
  onRerun,
  streaming = false,
}: {
  continuedByUser?: boolean;
  disabled: boolean;
  message: ChatMessage;
  modelId?: string;
  onEdit?(message: ChatMessage, text: string): void;
  onPromptReference(reference: PromptReference): void;
  onRerun?(): void;
  streaming?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const showActions = !continuedByUser && !disabled && !editing && Boolean(text || onRerun);
  const telemetry =
    !editing && message.role === "assistant" ? readResponseTelemetry(message.metadata) : undefined;
  const showElapsedTime = streaming && !editing && message.role === "assistant";
  const completedDurationMs = readCompletedDuration(message.metadata);
  const responseStartedAt = readResponseStartedAt(message.metadata);
  return (
    <Message
      actions={
        showActions || telemetry || showElapsedTime ? (
          <MessageFooter
            onCopy={showActions && text ? () => copyMessage(text) : undefined}
            onEdit={
              showActions && message.role === "user" && text ? () => setEditing(true) : undefined
            }
            onRerun={showActions && message.role === "assistant" ? onRerun : undefined}
            role={message.role}
            completedDurationMs={completedDurationMs}
            startedAt={showElapsedTime ? responseStartedAt : undefined}
            telemetry={telemetry}
          />
        ) : null
      }
      avatar={
        message.role === "assistant" ? <ModelIcon className="size-6" modelId={modelId} /> : null
      }
      compactAfter={continuedByUser}
      role={message.role}
    >
      {editing ? (
        <>
          {message.parts
            .filter((part) => part.type !== "text")
            .map((part, index) => (
              <MessagePartView
                key={`${part.type}-${index}`}
                onPromptReference={onPromptReference}
                part={part}
                role={message.role}
              />
            ))}
          <UserMessageEditor
            initialText={text}
            onCancel={() => setEditing(false)}
            onSubmit={(draft) => {
              setEditing(false);
              onEdit?.(message, draft);
            }}
          />
        </>
      ) : (
        <>
          <MessageParts
            onPromptReference={onPromptReference}
            parts={message.parts}
            role={message.role}
          />
          {disabled && message.role === "assistant" && message.parts.length === 0 ? (
            <div
              className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              Thinking
            </div>
          ) : null}
        </>
      )}
    </Message>
  );
}

function MessageFooter({
  completedDurationMs,
  onCopy,
  onEdit,
  onRerun,
  role,
  startedAt,
  telemetry,
}: {
  completedDurationMs?: number;
  onCopy?(): Promise<boolean>;
  onEdit?(): void;
  onRerun?(): void;
  role: ChatMessage["role"];
  startedAt?: string;
  telemetry?: ResponseTelemetry;
}) {
  return (
    <div
      className={cn(
        "-mt-1 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 md:-mt-2",
        role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {telemetry ? <ResponseTelemetryLine telemetry={telemetry} /> : null}
      {!telemetry && startedAt ? (
        <ResponseElapsedTime completedDurationMs={completedDurationMs} startedAt={startedAt} />
      ) : null}
      {onCopy || onEdit || onRerun ? (
        <MessageActions onCopy={onCopy} onEdit={onEdit} onRerun={onRerun} />
      ) : null}
    </div>
  );
}

function readCompletedDuration(metadata: Record<string, unknown>): number | undefined {
  const durationMs = metadata.responseDurationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : undefined;
}

function readResponseStartedAt(metadata: Record<string, unknown>): string | undefined {
  const startedAt = metadata.responseStartedAt;
  return typeof startedAt === "string" && Number.isFinite(new Date(startedAt).getTime())
    ? startedAt
    : undefined;
}

type ActivityPart = Extract<MessagePart, { type: "reasoning" | "tool" }>;
type ToolPart = Extract<MessagePart, { type: "tool" }>;

function MessageParts({
  onPromptReference,
  parts,
  role,
}: {
  onPromptReference(reference: PromptReference): void;
  parts: MessagePart[];
  role: ChatMessage["role"];
}) {
  const rendered: ReactNode[] = [];
  const revisions = parts.filter((part) => part.type === "prompt-revision");
  const chronologicalParts = parts.filter((part) => part.type !== "prompt-revision");
  let index = 0;

  while (index < chronologicalParts.length) {
    const part = chronologicalParts[index];
    if (part.type !== "reasoning" && part.type !== "tool") {
      rendered.push(
        <MessagePartView
          key={`${part.type}-${index}`}
          onPromptReference={onPromptReference}
          part={part}
          role={role}
        />,
      );
      index += 1;
      continue;
    }

    const start = index;
    const activity: ActivityPart[] = [];
    while (index < chronologicalParts.length) {
      const candidate = chronologicalParts[index];
      if (candidate.type !== "reasoning" && candidate.type !== "tool") break;
      activity.push(candidate);
      index += 1;
    }
    rendered.push(<ActivityGroup key={`activity-${start}`} parts={activity} />);
  }

  for (const [revisionIndex, revision] of revisions.entries()) {
    rendered.push(
      <MessagePartView
        key={`prompt-revision-${revisionIndex}`}
        onPromptReference={onPromptReference}
        part={revision}
        role={role}
      />,
    );
  }

  return rendered;
}

function ActivityGroup({ parts }: { parts: ActivityPart[] }) {
  if (parts.length === 1 && parts[0]?.type === "reasoning") {
    return <Reasoning streaming={parts[0].streaming} summary={parts[0].summary} />;
  }
  return <GroupedActivity parts={parts} />;
}

function GroupedActivity({ parts }: { parts: ActivityPart[] }) {
  const [open, setOpen] = useState(false);
  const toolCount = parts.filter((part) => part.type === "tool").length;
  const reasoningCount = parts.filter((part) => part.type === "reasoning").length;
  const summary = activitySummary(
    reasoningCount,
    parts.filter((part): part is ToolPart => part.type === "tool"),
  );

  return (
    <details
      className="group/activity not-prose text-xs text-muted-foreground"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="flex w-full cursor-pointer list-none items-center gap-2 py-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        <span className="flex size-5 shrink-0 items-center justify-center">
          {toolCount ? (
            <Wrench aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
          ) : (
            <Brain aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 group-open/activity:rotate-90"
        />
      </summary>
      <div className="ml-2 border-l border-border/70 pl-3">
        {parts.map((part, index) =>
          part.type === "reasoning" ? (
            <Reasoning
              key={`reasoning-${index}`}
              nested
              streaming={part.streaming}
              summary={part.summary}
            />
          ) : (
            <Tool key={part.callId || `tool-${index}`} nested part={part} />
          ),
        )}
      </div>
    </details>
  );
}

function activitySummary(reasoningCount: number, tools: ToolPart[]) {
  const activities = reasoningCount
    ? [`Reasoned in ${reasoningCount} ${reasoningCount === 1 ? "step" : "steps"}`]
    : [];
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const action = toolAction(tool.name);
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  for (const [action, count] of counts) activities.push(toolActionSummary(action, count));
  return activities.join(" · ");
}

function toolAction(name: string) {
  if (name === "web_search_exa") return "web-search";
  if (name === "read_prompt") return "read-prompt";
  if (name === "edit_prompt") return "edit-prompt";
  if (name === "create_prompt") return "create-prompt";
  if (name === "evaluate") return "evaluate";
  if (name === "search_prompts") return "search-prompts";
  if (name === "list_prompts") return "list-prompts";
  return name;
}

function toolActionSummary(action: string, count: number) {
  if (action === "web-search") return `Searched the web ${count} ${count === 1 ? "time" : "times"}`;
  if (action === "read-prompt") return `Read ${count} ${count === 1 ? "prompt" : "prompts"}`;
  if (action === "edit-prompt") return `Edited ${count} ${count === 1 ? "prompt" : "prompts"}`;
  if (action === "create-prompt") return `Created ${count} ${count === 1 ? "prompt" : "prompts"}`;
  if (action === "evaluate") return `Ran ${count} ${count === 1 ? "evaluation" : "evaluations"}`;
  if (action === "search-prompts")
    return `Searched prompts ${count} ${count === 1 ? "time" : "times"}`;
  if (action === "list-prompts") return `Listed prompts ${count} ${count === 1 ? "time" : "times"}`;
  return `Ran ${action} ${count} ${count === 1 ? "time" : "times"}`;
}

function MessagePartView({
  onPromptReference,
  part,
  role,
}: {
  onPromptReference(reference: PromptReference): void;
  part: MessagePart;
  role: ChatMessage["role"];
}) {
  if (part.type === "text")
    return role === "assistant" ? (
      <ResponseText text={part.text} />
    ) : (
      <div className="w-fit whitespace-pre-wrap break-words rounded-[1.35rem] rounded-br-md border border-white/10 bg-[var(--user-bubble-bg)] px-4 py-2.5 text-left text-[var(--user-bubble-fg)] shadow-[0_5px_16px_-10px_hsl(240_10%_4%/0.75)] transition-shadow duration-200 hover:shadow-[0_7px_20px_-10px_hsl(240_10%_4%/0.85)]">
        {part.text}
      </div>
    );
  if (part.type === "file")
    return (
      <a
        className="mb-2 flex max-w-64 items-center gap-2 rounded-xl border border-white/15 bg-white/10 p-2 text-xs hover:bg-white/15"
        download={part.name}
        href={part.dataUrl}
      >
        {part.mediaType.startsWith("image/") ? (
          <img alt="" className="size-11 rounded-lg object-cover" src={part.dataUrl} />
        ) : (
          <span className="grid size-11 place-items-center rounded-lg bg-black/10">
            <FileText aria-hidden="true" className="size-5" />
          </span>
        )}
        <span className="truncate">{part.name}</span>
      </a>
    );
  if (part.type === "reasoning") {
    return <Reasoning streaming={part.streaming} summary={part.summary} />;
  }
  if (part.type === "tool") return <Tool part={part} />;
  if (part.type === "prompt-quote")
    return (
      <button
        className="mb-2 block max-w-xl rounded-xl border bg-background/10 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground"
        onClick={() => onPromptReference({ promptId: part.promptId, quote: part })}
        type="button"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Quote aria-hidden="true" className="size-3.5" /> Quoted from {part.title}
          <span className="font-mono text-[10px] opacity-70">{part.revisionId.slice(0, 8)}</span>
        </span>
        <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-xs leading-5 opacity-80">
          {part.text}
        </span>
      </button>
    );
  if (part.type === "target-run-quote")
    return (
      <Link
        className="mb-2 inline-flex max-w-xl items-center gap-2 rounded-xl border bg-background/10 px-3 py-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        href={`/target-runs/${part.runId}`}
      >
        <FlaskConical aria-hidden="true" className="size-3.5" /> Target Run
        <span className="font-mono text-[10px] opacity-70">{part.runId.slice(0, 8)}</span>
      </Link>
    );
  if (part.type === "prompt-revision")
    return (
      <button
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        onClick={() => onPromptReference({ promptId: part.promptId, revisionId: part.revisionId })}
        type="button"
      >
        <GitCommitHorizontal aria-hidden="true" className="size-3.5" /> Review changes
      </button>
    );
  return (
    <details className="my-3 rounded-xl border bg-card px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <BarChart3 aria-hidden="true" className="size-3.5" /> Evaluation result
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(part.report, null, 2)}
      </pre>
      {part.runId ? (
        <Link
          className="mt-2 inline-flex rounded-md border px-2 py-1 font-medium hover:bg-accent"
          href={`/evaluations/${part.runId}`}
        >
          Open persisted report
        </Link>
      ) : null}
    </details>
  );
}

function MessageActions({
  onCopy,
  onEdit,
  onRerun,
}: {
  onCopy?(): Promise<boolean>;
  onEdit?(): void;
  onRerun?(): void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
      {onCopy ? (
        <ActionButton
          label={copied ? "Copied" : "Copy message"}
          onClick={() =>
            void onCopy().then((success) => {
              if (!success) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            })
          }
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </ActionButton>
      ) : null}
      {onEdit ? (
        <ActionButton label="Edit message" onClick={onEdit}>
          <Pencil aria-hidden="true" className="size-3.5" />
        </ActionButton>
      ) : null}
      {onRerun ? (
        <ActionButton label="Rerun from this message" onClick={onRerun}>
          <RefreshCcw aria-hidden="true" className="size-3.5" />
        </ActionButton>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function UserMessageEditor({
  initialText,
  onCancel,
  onSubmit,
}: {
  initialText: string;
  onCancel(): void;
  onSubmit(text: string): void;
}) {
  const [draft, setDraft] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [draft]);

  function submit() {
    const text = draft.trim();
    if (text) onSubmit(text);
  }

  return (
    <div className="w-[min(32rem,75vw)] max-w-full rounded-2xl border bg-card p-2 shadow-sm">
      <textarea
        aria-label="Edit message"
        autoFocus
        className="min-h-20 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm leading-6 outline-none"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        ref={textareaRef}
        value={draft}
      />
      <div className="mt-1 flex justify-end gap-1.5">
        <button
          className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={!draft.trim()}
          onClick={submit}
          type="button"
        >
          Send
        </button>
      </div>
    </div>
  );
}

async function copyMessage(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("Message could not be copied.");
    return false;
  }
}
