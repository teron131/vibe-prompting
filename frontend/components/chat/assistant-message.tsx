/** Reconstructs persisted and live assistant messages with copy actions and optional prompt or evaluation artifacts. */

"use client";

import {
  BarChart3,
  Check,
  Copy,
  FileText,
  GitCommitHorizontal,
  LoaderCircle,
  Pencil,
  Quote,
  RefreshCcw,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Message } from "@/components/chat/elements/message";
import { Reasoning } from "@/components/chat/elements/reasoning";
import { ResponseText } from "@/components/chat/elements/response";
import { Tool } from "@/components/chat/elements/tool";
import { cn } from "@/components/ui/utils";
import type { ChatMessage, MessagePart } from "@/contracts/chat";

import { ModelIcon } from "./model-selector";

type PromptReference = {
  promptId: string;
  quote?: Extract<MessagePart, { type: "prompt-quote" }>;
};

export function AssistantMessage({
  disabled,
  message,
  modelId,
  onEdit,
  onPromptReference,
  onRerun,
}: {
  disabled: boolean;
  message: ChatMessage;
  modelId?: string;
  onEdit?(message: ChatMessage, text: string): void;
  onPromptReference(reference: PromptReference): void;
  onRerun?(): void;
}) {
  const [editing, setEditing] = useState(false);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return (
    <Message
      actions={
        !disabled && !editing && (text || onRerun) ? (
          <MessageActions
            onCopy={text ? () => copyMessage(text) : undefined}
            onEdit={message.role === "user" && text ? () => setEditing(true) : undefined}
            onRerun={message.role === "assistant" ? onRerun : undefined}
            role={message.role}
          />
        ) : null
      }
      avatar={
        message.role === "assistant" ? <ModelIcon className="size-6" modelId={modelId} /> : null
      }
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
          {message.parts.map((part, index) => (
            <MessagePartView
              key={`${part.type}-${index}`}
              onPromptReference={onPromptReference}
              part={part}
              role={message.role}
            />
          ))}
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
  if (part.type === "reasoning") return <Reasoning summary={part.summary} />;
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
  if (part.type === "prompt-revision")
    return (
      <button
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        onClick={() => onPromptReference({ promptId: part.promptId })}
        type="button"
      >
        <GitCommitHorizontal aria-hidden="true" className="size-3.5" /> Revision{" "}
        {part.revisionId.slice(0, 8)}
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
  role,
}: {
  onCopy?(): Promise<boolean>;
  onEdit?(): void;
  onRerun?(): void;
  role: ChatMessage["role"];
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100",
        role === "user" ? "self-end" : "self-start",
      )}
    >
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
