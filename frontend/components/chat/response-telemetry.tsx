/** Projects persisted telemetry into quiet per-response and conversation measurements. */

"use client";

import { useEffect, useState } from "react";

import type { ChatMessage, ResponseTelemetry } from "@/contracts/chat";

export type ResponseTelemetrySummary = {
  estimatedCostUsd: number | null;
  totalTokens: number | null;
};

const compactNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const durationDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const durationWhole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const currency = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: "currency",
});

export function ResponseTelemetryLine({ telemetry }: { telemetry: ResponseTelemetry }) {
  const segments = responseTelemetrySegments(telemetry);
  if (!segments.length) return null;
  return (
    <span
      aria-label="Response telemetry"
      className="flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] tabular-nums text-muted-foreground/80"
      title="End-to-end time includes tools. Tokens and estimated cost cover the primary model calls attributed to this response; tool-owned model calls may be accounted separately. Cost uses OpenRouter effective pricing."
    >
      {segments.map((segment, index) => (
        <span className="inline-flex items-center gap-x-1.5" key={segment}>
          {index ? <span aria-hidden="true">·</span> : null}
          <span>{segment}</span>
        </span>
      ))}
    </span>
  );
}

export function ResponseElapsedTime({
  completedDurationMs,
  startedAt,
}: {
  completedDurationMs?: number;
  startedAt: string;
}) {
  const [durationMs, setDurationMs] = useState(() => elapsedDuration(startedAt));

  useEffect(() => {
    if (completedDurationMs !== undefined) return;
    const update = () => setDurationMs(elapsedDuration(startedAt));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [completedDurationMs, startedAt]);

  return (
    <span
      aria-label="Elapsed response time"
      aria-live="off"
      className="font-mono text-[11px] tabular-nums text-muted-foreground/80"
      title="Elapsed time while this response is running."
    >
      {completedDurationMs === undefined
        ? formatLiveDuration(durationMs)
        : formatCompletedDuration(completedDurationMs)}
    </span>
  );
}

export function ResponseTelemetryTotal({
  summary,
}: {
  summary: ResponseTelemetrySummary | undefined;
}) {
  if (!summary || (summary.totalTokens === null && summary.estimatedCostUsd === null)) return null;
  return (
    <div
      className="mt-2 flex flex-wrap justify-start gap-x-1.5 px-3 font-mono text-[10px] tabular-nums text-muted-foreground/75"
      title="This total appears only when every completed response in the current conversation has measured telemetry. Cost uses OpenRouter effective pricing."
    >
      <span>Total</span>
      {summary.totalTokens !== null ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{formatTokens(summary.totalTokens)}</span>
        </>
      ) : null}
      {summary.estimatedCostUsd !== null ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{currency.format(summary.estimatedCostUsd)}</span>
        </>
      ) : null}
    </div>
  );
}

export function readResponseTelemetry(
  metadata: Record<string, unknown>,
): ResponseTelemetry | undefined {
  if (!isRecord(metadata.telemetry)) return undefined;
  const durationMs = finiteNumber(metadata.telemetry.durationMs);
  if (durationMs === undefined) return undefined;
  return {
    durationMs,
    estimatedCostUsd: finiteNumber(metadata.telemetry.estimatedCostUsd) ?? null,
    inputTokens: finiteNumber(metadata.telemetry.inputTokens) ?? null,
    outputTokens: finiteNumber(metadata.telemetry.outputTokens) ?? null,
    requests: finiteNumber(metadata.telemetry.requests) ?? null,
    totalTokens: finiteNumber(metadata.telemetry.totalTokens) ?? null,
  };
}

export function summarizeResponseTelemetry(
  messages: ChatMessage[],
): ResponseTelemetrySummary | undefined {
  const assistantMessages = messages.filter(({ role }) => role === "assistant");
  if (!assistantMessages.length) return undefined;
  const measured: ResponseTelemetry[] = [];
  for (const { metadata } of assistantMessages) {
    const telemetry = readResponseTelemetry(metadata);
    if (telemetry) measured.push(telemetry);
    else if (!hasResponseStarted(metadata)) return undefined;
  }
  if (!measured.length) return undefined;
  const tokenValues = measured.map(({ totalTokens }) => totalTokens);
  const costValues = measured.map(({ estimatedCostUsd }) => estimatedCostUsd);
  return {
    estimatedCostUsd: costValues.every((value) => value !== null)
      ? costValues.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
    totalTokens: tokenValues.every((value) => value !== null)
      ? tokenValues.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
  };
}

function responseTelemetrySegments(telemetry: ResponseTelemetry): string[] {
  return [
    formatCompletedDuration(telemetry.durationMs),
    ...(telemetry.totalTokens === null ? [] : [formatTokens(telemetry.totalTokens)]),
    ...(telemetry.estimatedCostUsd === null ? [] : [currency.format(telemetry.estimatedCostUsd)]),
  ];
}

function elapsedDuration(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  return Number.isFinite(start) ? Math.max(0, Date.now() - start) : 0;
}

function formatLiveDuration(durationMs: number): string {
  return `${durationWhole.format(Math.floor(durationMs / 1_000))}s`;
}

function formatCompletedDuration(durationMs: number): string {
  return `${durationDecimal.format(durationMs / 1_000)}s`;
}

function formatTokens(tokens: number): string {
  return tokens < 1_000 ? String(tokens) : compactNumber.format(tokens);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function hasResponseStarted(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.responseStartedAt === "string" &&
    Number.isFinite(new Date(metadata.responseStartedAt).getTime())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
