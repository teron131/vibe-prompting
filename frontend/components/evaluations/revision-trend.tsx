/** Draws fingerprint-compatible Boolean criterion trends with one independent line per criterion. */

import Link from "next/link";

import type { BooleanTrendPoint } from "@/contracts/evaluations";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function RevisionTrend({ points }: { points: BooleanTrendPoint[] }) {
  if (points.length < 2) return null;
  const criteria = points[0]?.rates ?? [];
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Compatible revision trend</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Only completed runs with the same target, cases, criteria, and judge set appear.
        </p>
      </div>
      <div className="space-y-5">
        {criteria.map((criterion, index) => {
          const values = points.map((point) => {
            const rate = point.rates.find(
              ({ criterionPosition }) => criterionPosition === criterion.criterionPosition,
            );
            return rate && rate.total ? rate.passed / rate.total : 0;
          });
          const coordinates = values
            .map(
              (value, pointIndex) =>
                `${20 + (pointIndex * 280) / Math.max(points.length - 1, 1)},${75 - value * 60}`,
            )
            .join(" ");
          return (
            <div key={criterion.criterionPosition}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">{criterion.criterion}</span>
                <span className="text-muted-foreground">
                  {Math.round((values.at(-1) ?? 0) * 100)}% latest
                </span>
              </div>
              <svg
                aria-label={`Pass-rate trend for ${criterion.criterion}`}
                className="h-24 w-full"
                preserveAspectRatio="none"
                role="img"
                viewBox="0 0 320 90"
              >
                <line stroke="var(--border)" x1="20" x2="300" y1="75" y2="75" />
                <line stroke="var(--border)" x1="20" x2="300" y1="15" y2="15" />
                <polyline
                  fill="none"
                  points={coordinates}
                  stroke={COLORS[index % COLORS.length]}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
                {values.map((value, pointIndex) => (
                  <circle
                    cx={20 + (pointIndex * 280) / Math.max(points.length - 1, 1)}
                    cy={75 - value * 60}
                    fill={COLORS[index % COLORS.length]}
                    key={points[pointIndex]?.runId}
                    r="3"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                {points.map((point) => (
                  <Link
                    className="truncate hover:text-foreground"
                    href={`/evaluations/${point.runId}`}
                    key={point.runId}
                  >
                    {point.revisionId.slice(0, 6)}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
