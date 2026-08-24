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
const textRemarkPlugins = Object.entries(defaultRemarkPlugins)
  .filter(([name]) => name !== "math")
  .map(([, plugin]) => plugin) as NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]>;
const responseComponents: NonNullable<ComponentProps<typeof Streamdown>["components"]> = {
  img: MarkdownImage,
};
const textOnlyResponseComponents: NonNullable<ComponentProps<typeof Streamdown>["components"]> = {
  img: MarkdownImageLabel,
};

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
  renderImages = true,
  renderMath = true,
  text,
}: {
  className?: string;
  compact?: boolean;
  renderImages?: boolean;
  renderMath?: boolean;
  text: string;
}) {
  const normalizedText = renderMath ? normalizeLatexDelimiters(text) : text;
  return (
    <Streamdown
      className={cn(
        "size-full min-w-0 text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a]:underline-offset-2 [&_code]:break-words [&_code]:whitespace-pre-wrap [&_code]:text-sm [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:leading-7 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:leading-7 [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:leading-6 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre_code]:break-normal! [&_pre_code]:whitespace-pre! dark:[&_a]:text-blue-300",
        compact &&
          "text-xs! leading-4! [&_code]:text-xs! [&_h1]:my-1.5! [&_h1]:text-sm! [&_h1]:leading-5! [&_h2]:my-1.5! [&_h2]:text-xs! [&_h2]:leading-4! [&_h3]:my-1! [&_h3]:text-xs! [&_h3]:leading-4! [&_li]:my-0.5! [&_ol]:my-1.5! [&_p]:my-1.5! [&_pre]:text-xs! [&_ul]:my-1.5!",
        className,
      )}
      components={renderImages ? responseComponents : textOnlyResponseComponents}
      mode={renderMath && normalizedText.includes("$$") ? "static" : "streaming"}
      remarkPlugins={renderMath ? responseRemarkPlugins : textRemarkPlugins}
    >
      {normalizedText}
    </Streamdown>
  );
}

function MarkdownImage({ node: _node, ...props }: ComponentProps<"img"> & { node?: unknown }) {
  return (
    <img
      {...props}
      alt={props.alt ?? ""}
      className={cn("my-4 max-w-full rounded-lg", props.className)}
      decoding="async"
      loading="lazy"
    />
  );
}

function MarkdownImageLabel({ alt }: ComponentProps<"img"> & { node?: unknown }) {
  return <span>[Image{alt ? `: ${alt}` : ""}]</span>;
}
