/** Presents live prompt size metadata while making the model-dependent token count explicitly approximate. */

import { cn } from "@/components/ui/utils";

const numberFormat = new Intl.NumberFormat();
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function PromptStats({ className, markdown }: { className?: string; markdown: string }) {
  const words = Array.from(wordSegmenter.segment(markdown)).filter(
    (segment) => segment.isWordLike,
  ).length;
  const tokens = markdown ? Math.ceil(new TextEncoder().encode(markdown).length / 4) : 0;

  return (
    <span
      aria-label={`${numberFormat.format(words)} words, approximately ${numberFormat.format(tokens)} tokens`}
      className={cn("text-xs tabular-nums text-muted-foreground", className)}
    >
      {numberFormat.format(words)} words · ~{numberFormat.format(tokens)} tokens
    </span>
  );
}
