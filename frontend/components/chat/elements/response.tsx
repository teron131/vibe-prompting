/** Renders streaming Markdown with the same math-aware response pipeline used by Master UI. */

"use client";

import type { ComponentProps } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

import { cn } from "@/components/ui/utils";

const mathPlugin = defaultRemarkPlugins.math;
const responseRemarkPlugins: ComponentProps<typeof Streamdown>["remarkPlugins"] = Array.isArray(
  mathPlugin,
)
  ? (Object.values({
      ...defaultRemarkPlugins,
      math: [mathPlugin[0], { singleDollarTextMath: false }],
    }) as NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]>)
  : Object.values(defaultRemarkPlugins);

const markdownCodePattern = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|$))/g;

/** Converts model-standard LaTeX delimiters without rewriting examples inside Markdown code. */
function normalizeLatexDelimiters(markdown: string) {
  return markdown
    .split(markdownCodePattern)
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment;
      }

      return segment
        .replace(/\\\[/g, () => "$$")
        .replace(/\\\]/g, () => "$$")
        .replace(/\\\(/g, () => "$$")
        .replace(/\\\)/g, () => "$$");
    })
    .join("");
}

export function ResponseText({ className, text }: { className?: string; text: string }) {
  return (
    <Streamdown
      className={cn(
        "size-full min-w-0 text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a]:underline-offset-2 [&_code]:break-words [&_code]:whitespace-pre-wrap [&_code]:text-sm [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre_code]:break-normal! [&_pre_code]:whitespace-pre! dark:[&_a]:text-blue-300",
        className,
      )}
      remarkPlugins={responseRemarkPlugins}
    >
      {normalizeLatexDelimiters(text)}
    </Streamdown>
  );
}
