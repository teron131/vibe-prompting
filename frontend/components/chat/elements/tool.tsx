/** Ports Master UI's compact tool activity disclosure onto persisted assistant tool parts. */

"use client";

import { ChevronRight, CircleAlert, ExternalLink, LoaderCircle, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ResponseText } from "@/components/chat/elements/response";
import { cn } from "@/components/ui/utils";
import type { MessagePart } from "@/contracts/chat";

type ToolPart = Extract<MessagePart, { type: "tool" }>;

export function Tool({ nested = false, part }: { nested?: boolean; part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const artifact = readArtifact(part.output);

  return (
    <details
      className={cn("group/tool not-prose w-full max-w-full overflow-hidden", !nested && "mb-2")}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        className={cn(
          "flex w-full min-w-0 cursor-pointer list-none items-center gap-2.5 text-left transition-colors hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:hover:text-white [&::-webkit-details-marker]:hidden",
          nested ? "h-7 py-0" : "py-2",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Wrench aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Tool</span>
          <span className="truncate font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200">
            {part.name}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open/tool:rotate-90 group-hover/tool:text-zinc-700 dark:group-hover/tool:text-zinc-200"
        />
        <ToolState state={part.state} />
      </summary>
      <div className="ml-2 min-w-0 max-w-full border-l border-border/70 pb-1 pl-3 pr-2 text-popover-foreground">
        {part.input !== undefined && part.input !== null ? (
          <ToolSection label="Input" value={part.input} />
        ) : null}
        {part.output !== undefined && part.output !== null ? (
          <ToolSection label={part.state === "failed" ? "Error" : "Output"} value={part.output} />
        ) : null}
        {artifact ? (
          <Link
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 underline underline-offset-2 dark:text-blue-300"
            href={artifact.href}
          >
            Open {artifact.kind} artifact
            <ExternalLink aria-hidden="true" className="size-3" />
          </Link>
        ) : null}
      </div>
    </details>
  );
}

function ToolState({ state }: { state: ToolPart["state"] }) {
  if (state === "running") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> Running
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        <CircleAlert aria-hidden="true" className="size-3" /> Failed
      </span>
    );
  }
  return null;
}

function ToolSection({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="border-t border-zinc-200/80 py-3 first:border-t-0 dark:border-zinc-800/80">
      <h4 className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</h4>
      <div className="max-h-72 min-w-0 max-w-full overflow-x-hidden overflow-y-auto text-zinc-600 dark:text-zinc-400">
        <StructuredValue value={normalizeValue(value)} />
      </div>
    </section>
  );
}

function StructuredValue({ nested = false, value }: { nested?: boolean; value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-zinc-500">None</span>;
    return (
      <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
        {value.map((item, index) => (
          <div className="py-2.5 first:pt-0 last:pb-0" key={index}>
            <StructuredValue nested value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    const directText = typeof value.text === "string" ? value.text : undefined;
    if (directText) return <ResponseText compact text={directText} />;
    const entries = Object.entries(value).filter(([key]) => !key.startsWith("_") && key !== "type");
    if (!entries.length) return <span className="text-zinc-500">None</span>;
    return (
      <dl className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
        {entries.map(([key, item]) => (
          <div
            className={cn(
              "grid gap-1.5 py-2.5 first:pt-0 last:pb-0",
              !nested && "sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3",
            )}
            key={key}
          >
            <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {humanizeLabel(key)}
            </dt>
            <dd className="min-w-0 text-xs leading-4 text-zinc-800 dark:text-zinc-200">
              <StructuredValue nested value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (value === null || value === undefined || value === "") {
    return <span className="text-zinc-500">None</span>;
  }
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return (
      <a
        className="inline-flex max-w-full items-center gap-1 text-blue-700 underline underline-offset-2 dark:text-blue-300"
        href={value}
        rel="noreferrer"
        target="_blank"
      >
        <span className="truncate">{sourceLabel(value)}</span>
        <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
      </a>
    );
  }
  if (typeof value === "string") return <ResponseText compact text={value} />;
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function humanizeLabel(value: string): string {
  const label = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function readArtifact(value: unknown): { href: string; kind: string } | undefined {
  if (!isRecord(value) || !isRecord(value.artifact)) return undefined;
  return typeof value.artifact.href === "string" && typeof value.artifact.kind === "string"
    ? { href: value.artifact.href, kind: value.artifact.kind }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
