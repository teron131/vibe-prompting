/** Renders an adjacent prompt revision as an accessible, compact, line-numbered addition and removal diff. */

import { buildPromptDiff } from "@/components/prompts/diff-model";
import { cn } from "@/components/ui/utils";

export function PromptDiff({ after, before }: { after: string; before: string }) {
  const lines = buildPromptDiff(before, after);
  return (
    <div className="overflow-hidden rounded-lg border bg-card font-mono text-xs leading-5">
      {lines.length === 0 ? (
        <div className="px-3 py-4 text-muted-foreground">No Markdown change in this revision.</div>
      ) : (
        lines.map((line, index) =>
          line.kind === "collapsed" ? (
            <div
              className="border-b border-border/50 bg-muted/40 px-3 py-1 text-center font-sans text-[11px] text-muted-foreground last:border-0"
              key={`collapsed-${index}`}
            >
              {line.hiddenLineCount} unchanged {line.hiddenLineCount === 1 ? "line" : "lines"}{" "}
              hidden
            </div>
          ) : (
            <div
              className={cn(
                "grid grid-cols-[2.25rem_2.25rem_2rem_minmax(0,1fr)] border-b border-border/50 py-0.5 last:border-0",
                line.kind === "added" && "bg-chart-2/10",
                line.kind === "removed" && "bg-destructive/10",
              )}
              key={`${line.kind}-${index}`}
            >
              <span
                aria-hidden="true"
                className="select-none border-r border-border/50 px-1.5 text-right text-muted-foreground"
              >
                {line.oldLineNumber ?? ""}
              </span>
              <span
                aria-hidden="true"
                className="select-none border-r border-border/50 px-1.5 text-right text-muted-foreground"
              >
                {line.newLineNumber ?? ""}
              </span>
              <span
                aria-hidden="true"
                className="select-none px-2 text-center text-muted-foreground"
              >
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              </span>
              <span className="sr-only">
                {line.kind === "added"
                  ? `Added line ${line.newLineNumber}: `
                  : line.kind === "removed"
                    ? `Removed line ${line.oldLineNumber}: `
                    : `Unchanged line ${line.oldLineNumber}: `}
              </span>
              <span className="whitespace-pre-wrap break-all pe-2">
                {line.segments?.length
                  ? line.segments.map((segment, segmentIndex) => (
                      <span
                        className={cn(
                          segment.kind === "changed" &&
                            line.kind === "added" &&
                            "rounded-sm bg-chart-2/30",
                          segment.kind === "changed" &&
                            line.kind === "removed" &&
                            "rounded-sm bg-destructive/30",
                        )}
                        key={`${segment.kind}-${segmentIndex}`}
                      >
                        {segment.text}
                      </span>
                    ))
                  : line.text || " "}
              </span>
            </div>
          ),
        )
      )}
    </div>
  );
}
