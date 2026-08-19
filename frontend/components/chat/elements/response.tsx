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

export function ResponseText({
  className,
  compact = false,
  text,
}: {
  className?: string;
  compact?: boolean;
  text: string;
}) {
  return (
    <Streamdown
      className={cn(
        "size-full min-w-0 text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a]:underline-offset-2 [&_code]:break-words [&_code]:whitespace-pre-wrap [&_code]:text-sm [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre_code]:break-normal! [&_pre_code]:whitespace-pre! dark:[&_a]:text-blue-300",
        compact &&
          "text-xs! leading-4! [&_code]:text-xs! [&_h1]:my-1.5! [&_h1]:text-sm! [&_h1]:leading-5! [&_h2]:my-1.5! [&_h2]:text-xs! [&_h2]:leading-4! [&_h3]:my-1! [&_h3]:text-xs! [&_h3]:leading-4! [&_li]:my-0.5! [&_ol]:my-1.5! [&_p]:my-1.5! [&_pre]:text-xs! [&_ul]:my-1.5!",
        className,
      )}
      remarkPlugins={responseRemarkPlugins}
    >
      {normalizeLatexDelimiters(text)}
    </Streamdown>
  );
}
