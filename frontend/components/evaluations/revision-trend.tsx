/** Draws fingerprint-compatible Boolean criterion trends as compact ruled comparison rows. */

import Link from "next/link";

import type { BooleanTrendPoint } from "@/contracts/evaluations";

const PLOT_LEFT = 8;
const PLOT_RIGHT = 312;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 48;
const TREND_SCOPE = "Only like-for-like targets, cases, criteria, and judges are aligned.";

export function RevisionTrend({ points }: { points: BooleanTrendPoint[] }) {
  if (points.length < 2) return null;
  const criteria = points[0]?.rates ?? [];

  return (
    <section className="border-y">
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <h3 className="text-sm font-semibold">Compatible revision trend</h3>
          <p className="mt-1 text-xs text-muted-foreground">{TREND_SCOPE}</p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          BOOLEAN PASS RATE · {points.length} RUNS
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[50rem] border-collapse text-xs">
          <thead className="bg-muted/35 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-64 border-r px-4 py-2 text-left font-medium sm:px-5">Criterion</th>
              <th className="px-3 py-2 text-left font-medium">Pass rate over time</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Latest</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {criteria.map((criterion) => {
              const values = points.map((point) => {
                const rate = point.rates.find(
                  ({ criterionPosition }) => criterionPosition === criterion.criterionPosition,
                );
                return rate && rate.total
                  ? { passed: rate.passed, rate: rate.passed / rate.total, total: rate.total }
                  : { passed: 0, rate: 0, total: 0 };
              });
              const latest = values.at(-1) ?? { passed: 0, rate: 0, total: 0 };
              return (
                <tr key={criterion.criterionPosition}>
                  <th className="border-r px-4 py-3 text-left align-middle font-normal sm:px-5">
                    <span className="font-mono text-[11px] uppercase text-muted-foreground">
                      C{criterion.criterionPosition + 1}
                    </span>
                    <span className="mt-1 block max-w-sm leading-5">{criterion.criterion}</span>
                  </th>
                  <td className="px-3 py-2">
                    <TrendPlot
                      criterion={criterion.criterion}
                      points={points}
                      values={values.map(({ rate }) => rate)}
                    />
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <span className="block font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {Math.round(latest.rate * 100)}%
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                      {latest.passed}/{latest.total} PASS
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto border-t bg-muted/20">
        <div className="grid min-w-[50rem] grid-cols-[16rem_minmax(0,1fr)_7rem]">
          <span className="border-r px-4 py-2 font-mono text-[11px] uppercase text-muted-foreground sm:px-5">
            Run chronology
          </span>
          <div className="flex justify-between gap-2 px-3 py-2">
            {points.map((point) => (
              <Link
                className="min-w-0 text-center font-mono text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href={`/evaluations/${point.runId}`}
                key={point.runId}
                title={`${point.revisionId} · ${formatDate(point.completedAt)}`}
              >
                <span className="block font-medium">{point.revisionId.slice(0, 6)}</span>
                <span className="mt-0.5 block whitespace-nowrap">
                  {formatDate(point.completedAt)}
                </span>
              </Link>
            ))}
          </div>
          <span />
        </div>
      </div>
    </section>
  );
}

function TrendPlot({
  criterion,
  points,
  values,
}: {
  criterion: string;
  points: BooleanTrendPoint[];
  values: number[];
}) {
  const coordinates = values
    .map((value, index) => `${xFor(index, points.length)},${yFor(value)}`)
    .join(" ");
  return (
    <svg
      aria-label={`Boolean pass-rate trend for ${criterion}: ${values.map((value) => `${Math.round(value * 100)}%`).join(", ")}`}
      className="h-16 w-full text-emerald-700 dark:text-emerald-400"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 320 56"
    >
      {[0, 0.5, 1].map((rate) => (
        <line
          className="text-border"
          key={rate}
          stroke="currentColor"
          strokeDasharray={rate === 0.5 ? "2 3" : undefined}
          vectorEffect="non-scaling-stroke"
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={yFor(rate)}
          y2={yFor(rate)}
        />
      ))}
      <polyline
        fill="none"
        points={coordinates}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {values.map((value, index) => (
        <circle
          cx={xFor(index, points.length)}
          cy={yFor(value)}
          fill="var(--background)"
          key={points[index]?.runId}
          r="2.5"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function xFor(index: number, count: number): number {
  return PLOT_LEFT + (index * (PLOT_RIGHT - PLOT_LEFT)) / Math.max(count - 1, 1);
}

function yFor(value: number): number {
  return PLOT_BOTTOM - value * (PLOT_BOTTOM - PLOT_TOP);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(
    new Date(value),
  );
}
