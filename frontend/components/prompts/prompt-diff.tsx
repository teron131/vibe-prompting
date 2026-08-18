/** Renders an adjacent immutable prompt revision as an attributed line-level addition and removal diff. */

import { cn } from "@/components/ui/utils";

type DiffLine = { kind: "added" | "context" | "removed"; text: string };

export function PromptDiff({ after, before }: { after: string; before: string }) {
  const lines = diffLines(before, after);
  return (
    <div className="overflow-hidden rounded-lg border bg-card font-mono text-xs leading-5">
      {lines.length === 0 ? (
        <div className="px-3 py-4 text-muted-foreground">No Markdown change in this revision.</div>
      ) : (
        lines.map((line, index) => (
          <div
            className={cn(
              "grid grid-cols-[1.5rem_1fr] border-b border-border/50 px-2 py-0.5 last:border-0",
              line.kind === "added" && "bg-chart-2/10 text-chart-2",
              line.kind === "removed" && "bg-destructive/10 text-destructive",
            )}
            key={`${line.kind}-${index}`}
          >
            <span aria-hidden="true" className="select-none opacity-70">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
          </div>
        ))
      )}
    </div>
  );
}

function diffLines(before: string, after: string): DiffLine[] {
  if (before === after) return [];
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length * right.length > 60_000) {
    return [
      ...left.map((text) => ({ kind: "removed" as const, text })),
      ...right.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + lengths[leftIndex + 1]![rightIndex + 1]!
          : Math.max(lengths[leftIndex + 1]![rightIndex]!, lengths[leftIndex]![rightIndex + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      result.push({ kind: "context", text: left[leftIndex]! });
      leftIndex += 1;
      rightIndex += 1;
    } else if (lengths[leftIndex + 1]![rightIndex]! >= lengths[leftIndex]![rightIndex + 1]!) {
      result.push({ kind: "removed", text: left[leftIndex]! });
      leftIndex += 1;
    } else {
      result.push({ kind: "added", text: right[rightIndex]! });
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) result.push({ kind: "removed", text: left[leftIndex++]! });
  while (rightIndex < right.length) result.push({ kind: "added", text: right[rightIndex++]! });
  return result;
}
