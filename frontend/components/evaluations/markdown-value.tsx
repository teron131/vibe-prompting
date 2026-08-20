/** Gives persisted evaluation input and output values one consistent source and rendered Markdown view. */

"use client";

import { ReactNode, useState } from "react";

import { MarkdownPreview } from "@/components/prompts/artifact";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

export function EvaluationMarkdownValue({
  className,
  label,
  source,
  value,
}: {
  className?: string;
  label: string;
  source?: ReactNode;
  value: unknown;
}) {
  const [preview, setPreview] = useState(false);
  const markdown = typeof value === "string" ? value : undefined;
  const serialized = markdown ?? JSON.stringify(value, null, 2);

  return (
    <section className={cn("min-w-0 py-5", className)}>
      <header className="flex min-h-8 items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase text-muted-foreground">{label}</div>
        {markdown !== undefined ? (
          <Button onClick={() => setPreview((current) => !current)} size="sm" variant="ghost">
            {preview ? "Source" : "Preview"}
          </Button>
        ) : null}
      </header>
      {preview && markdown !== undefined ? (
        <MarkdownPreview className="mt-2 text-sm" markdown={markdown} />
      ) : (
        <div className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {source ?? serialized}
        </div>
      )}
    </section>
  );
}
