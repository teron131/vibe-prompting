/** Renders prompt Markdown with the compact heading and list treatment shared by prompt and evaluation views. */

"use client";

import { cn } from "@/components/ui/utils";

export function MarkdownPreview({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn("space-y-3 break-words text-sm leading-7", className)}>
      {markdown.split("\n").map((line, index) => {
        if (line.startsWith("### "))
          return (
            <h3 className="pt-2 text-base font-semibold" key={index}>
              {line.slice(4)}
            </h3>
          );
        if (line.startsWith("## "))
          return (
            <h2 className="pt-3 text-lg font-semibold" key={index}>
              {line.slice(3)}
            </h2>
          );
        if (line.startsWith("# "))
          return (
            <h1 className="pt-4 text-xl font-semibold" key={index}>
              {line.slice(2)}
            </h1>
          );
        if (/^[-*] /.test(line))
          return (
            <div className="flex gap-2 pl-2" key={index}>
              <span aria-hidden="true">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        if (!line) return <div aria-hidden="true" className="h-2" key={index} />;
        return (
          <p className="whitespace-pre-wrap" key={index}>
            {line}
          </p>
        );
      })}
    </div>
  );
}
