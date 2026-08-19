/** Renders prompt Markdown with the compact heading and list treatment shared by prompt and evaluation views. */

"use client";

import { ResponseText } from "@/components/chat/elements/response";

export function MarkdownPreview({ markdown, className }: { markdown: string; className?: string }) {
  const normalizedMarkdown = markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^[\t \u00a0]+/, (indent) => indent.replaceAll("\u00a0", " "))
        .replace(/^(\s*[-+*]\s+)> (?=\d)/, "$1\\> "),
    )
    .join("\n");
  return <ResponseText className={className} text={normalizedMarkdown} />;
}
