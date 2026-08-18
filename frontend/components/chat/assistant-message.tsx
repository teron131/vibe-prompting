/** Reconstructs persisted and live assistant messages with copy actions and optional prompt or evaluation artifacts. */

"use client";

import { BarChart3, Check, Copy, FileText, GitCommitHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Message } from "@/components/chat/elements/message";
import { Reasoning } from "@/components/chat/elements/reasoning";
import { ResponseText } from "@/components/chat/elements/response";
import { Tool } from "@/components/chat/elements/tool";
import { cn } from "@/components/ui/utils";
import type { ChatMessage, ConfiguredModel, MessagePart } from "@/contracts/chat";

import { ModelIcon } from "./model-selector";

export function AssistantMessage({
  message,
  model,
}: {
  message: ChatMessage;
  model?: ConfiguredModel;
}) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return (
    <Message
      actions={text ? <CopyAction role={message.role} text={text} /> : null}
      avatar={message.role === "assistant" ? <ModelIcon className="size-6" model={model} /> : null}
      role={message.role}
    >
      {message.parts.map((part, index) => (
        <MessagePartView key={`${part.type}-${index}`} part={part} role={message.role} />
      ))}
    </Message>
  );
}

function MessagePartView({ part, role }: { part: MessagePart; role: ChatMessage["role"] }) {
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
  if (part.type === "prompt-revision")
    return (
      <Link
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        href={`/prompts/${part.promptId}`}
      >
        <GitCommitHorizontal aria-hidden="true" className="size-3.5" /> Revision{" "}
        {part.revisionId.slice(0, 8)}
      </Link>
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

function CopyAction({ role, text }: { role: ChatMessage["role"]; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label="Copy message"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100",
        role === "user" ? "self-end" : "self-start",
      )}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
      }
      type="button"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}
