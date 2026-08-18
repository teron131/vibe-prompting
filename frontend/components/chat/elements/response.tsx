/** Renders safe assistant Markdown blocks, including the tables and mixed structures used in tool-backed answers. */

import { Fragment, type ReactNode } from "react";

import { cn } from "@/components/ui/utils";

export function ResponseText({ className, text }: { className?: string; text: string }) {
  return (
    <div
      className={cn(
        "size-full min-w-0 break-words text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-blue-300",
        className,
      )}
    >
      {renderBlocks(text)}
    </div>
  );
}

function renderBlocks(markdown: string): ReactNode[] {
  const lines = markdown.trim().split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith(fence[1])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre
          className="my-3 max-w-full overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5"
          key={`code-${index}`}
        >
          <code>{content.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(
        <Tag className="mb-2 mt-5 font-semibold" key={`heading-${index}`}>
          <InlineMarkdown text={heading[2]} />
        </Tag>,
      );
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="my-3 max-w-full overflow-x-auto rounded-lg border" key={`table-${index}`}>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/70">
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th className="border-b px-3 py-2 font-semibold" key={cellIndex}>
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr className="border-b last:border-b-0" key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td className="px-3 py-2 align-top" key={cellIndex}>
                      <InlineMarkdown text={row[cellIndex] ?? ""} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul className="my-3 list-disc space-y-1 pl-5" key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol className="my-3 list-decimal space-y-1 pl-5" key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground" key={`quote-${index}`}>
          <InlineMarkdown text={quote.join("\n")} />
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p className="my-3 whitespace-pre-wrap" key={`paragraph-${index}`}>
        <InlineMarkdown text={paragraph.join("\n")} />
      </p>,
    );
  }

  return blocks;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^(```|~~~)/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s?/.test(line) ||
    (index + 1 < lines.length && isTableDivider(lines[index + 1]))
  );
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(
    /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g,
  );
  return parts.map((part, index): ReactNode => {
    if (
      (part.startsWith("**") && part.endsWith("**")) ||
      (part.startsWith("__") && part.endsWith("__"))
    ) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a href={link[2]} key={index} rel="noreferrer" target="_blank">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
