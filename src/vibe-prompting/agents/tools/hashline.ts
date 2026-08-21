/** Owns the framework-neutral structured Hashline editing protocol for database-backed prompts without exposing a filesystem or raw patch grammar. */

import { createHash } from "node:crypto";

import { z } from "zod";

const HASH_LENGTH = 6;
const NEARBY_LINE_WINDOW = 3;
const HASHLINE_REF_PATTERN = new RegExp(`^\\d+#[0-9a-f]{${HASH_LENGTH}}$`, "u");
const HASHLINE_LINE_PATTERN = new RegExp(
  `^(?<ref>\\d+#[0-9a-f]{${HASH_LENGTH}}):(?<content>.*)$`,
  "u",
);

const hashlineRefSchema = z
  .string()
  .regex(HASHLINE_REF_PATTERN)
  .describe("A LINE#HASH reference copied from the latest read_prompt result.");

const replacementSchema = z.object({
  operation: z.literal("replace_range"),
  startRef: hashlineRefSchema.describe("The first physical line to replace, inclusive."),
  endRef: hashlineRefSchema.describe("The last physical line to replace, inclusive."),
  lines: z
    .array(z.string())
    .describe("Complete replacement lines without LINE#HASH prefixes; use [] to delete the range."),
});

const insertBeforeSchema = z.object({
  operation: z.literal("insert_before"),
  startRef: hashlineRefSchema.describe("The physical line immediately after the insertion."),
  lines: z
    .array(z.string())
    .min(1)
    .describe("Complete lines to insert without LINE#HASH prefixes."),
});

const insertAfterSchema = z.object({
  operation: z.literal("insert_after"),
  startRef: hashlineRefSchema.describe("The physical line immediately before the insertion."),
  lines: z
    .array(z.string())
    .min(1)
    .describe("Complete lines to insert without LINE#HASH prefixes."),
});

const appendSchema = z.object({
  operation: z.literal("append"),
  lines: z.array(z.string()).min(1).describe("Complete lines to append to the prompt."),
});

export const promptHashlineEditSchema = z.discriminatedUnion("operation", [
  replacementSchema,
  insertBeforeSchema,
  insertAfterSchema,
  appendSchema,
]);

export const promptHashlineEditsSchema = z
  .array(promptHashlineEditSchema)
  .min(1)
  .max(20)
  .describe(
    "Atomic line-addressed edits applied to the latest read_prompt result; every referenced line must still have the same hash.",
  );

export type PromptHashlineEdit = z.infer<typeof promptHashlineEditSchema>;

type ResolvedEdit = {
  end: number;
  lines: string[];
  start: number;
};

/** Applies one atomic batch against the original physical-line coordinates and rejects stale, overlapping, ambiguous, or no-op edits before returning content. */
export function applyPromptHashlineEdits(
  originalText: string,
  edits: PromptHashlineEdit[],
): string {
  const { hasTrailingNewline, lines } = splitTextLines(originalText);
  const resolved = edits.map((edit) => resolveEdit(edit, lines));
  validateEditTargets(resolved);

  const result = [...lines];
  for (const edit of resolved.toSorted(compareEditsDescending)) {
    result.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  const updatedText = joinTextLines(result, hasTrailingNewline);
  if (updatedText === originalText) throw new Error("The edits do not change the prompt.");
  return updatedText;
}

/** Presents prompt content as copyable LINE#HASH:content records while keeping the stored Markdown unchanged. */
export function formatPromptHashlines(text: string): string {
  const { lines } = splitTextLines(text);
  return lines.map((line, index) => `${formatHashlineRef(index + 1, line)}:${line}`).join("\n");
}

function computeLineHash(line: string): string {
  return createHash("sha256").update(line.replace(/\r$/u, "")).digest("hex").slice(0, HASH_LENGTH);
}

function formatHashlineRef(lineNumber: number, line: string): string {
  return `${lineNumber}#${computeLineHash(line)}`;
}

function resolveEdit(edit: PromptHashlineEdit, lines: string[]): ResolvedEdit {
  if (edit.operation === "append") {
    return { end: lines.length, lines: edit.lines, start: lines.length };
  }

  const startLine = resolveHashlineRef(edit.startRef, lines);
  const validRefs = new Set([edit.startRef]);
  if (edit.operation === "insert_before") {
    return {
      end: startLine - 1,
      lines: stripAccidentalPrefixes(edit.lines, validRefs),
      start: startLine - 1,
    };
  }
  if (edit.operation === "insert_after") {
    return {
      end: startLine,
      lines: stripAccidentalPrefixes(edit.lines, validRefs),
      start: startLine,
    };
  }

  const endLine = resolveHashlineRef(edit.endRef, lines);
  if (endLine < startLine) {
    throw new Error(
      `replace_range endRef must not precede startRef: ${edit.startRef} -> ${edit.endRef}`,
    );
  }
  validRefs.add(edit.endRef);
  return {
    end: endLine,
    lines: stripAccidentalPrefixes(edit.lines, validRefs),
    start: startLine - 1,
  };
}

/** Accepts an exact current reference or one uniquely shifted by at most three lines so sequential edits tolerate small local movement without weakening stale-content checks. */
function resolveHashlineRef(ref: string, lines: string[]): number {
  const [lineText, expectedHash] = ref.split("#");
  const lineNumber = Number(lineText);
  if (!Number.isSafeInteger(lineNumber) || !expectedHash || !HASHLINE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid hashline reference: ${JSON.stringify(ref)}`);
  }
  if (lineNumber >= 1 && lineNumber <= lines.length) {
    const line = lines[lineNumber - 1] ?? "";
    if (computeLineHash(line) === expectedHash) return lineNumber;
  }

  const nearbyStart = Math.max(1, lineNumber - NEARBY_LINE_WINDOW);
  const nearbyEnd = Math.min(lines.length, lineNumber + NEARBY_LINE_WINDOW);
  const nearbyMatches: number[] = [];
  for (let candidate = nearbyStart; candidate <= nearbyEnd; candidate += 1) {
    if (computeLineHash(lines[candidate - 1] ?? "") === expectedHash) nearbyMatches.push(candidate);
  }
  if (nearbyMatches.length === 1) return nearbyMatches[0] ?? lineNumber;
  throw new Error(buildStaleReferenceMessage(ref, lines, lineNumber));
}

function buildStaleReferenceMessage(ref: string, lines: string[], lineNumber: number): string {
  const details = [`Stale hashline reference: ${ref}`];
  if (lineNumber >= 1 && lineNumber <= lines.length) {
    const line = lines[lineNumber - 1] ?? "";
    details.push(`Current line: ${formatHashlineRef(lineNumber, line)}:${line}`);
  } else {
    details.push(`Current prompt has ${lines.length} physical lines.`);
  }
  const start = Math.max(1, lineNumber - 1);
  const end = Math.min(lines.length, lineNumber + 1);
  for (let index = start; index <= end; index += 1) {
    const line = lines[index - 1] ?? "";
    details.push(`${formatHashlineRef(index, line)}:${line}`);
  }
  return details.join("\n");
}

/** Prevents a batch from depending on edit ordering by rejecting targets whose original-coordinate effects are not independent. */
function validateEditTargets(edits: ResolvedEdit[]): void {
  const sorted = edits.toSorted((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    const duplicateInsertion =
      previous.start === previous.end &&
      current.start === current.end &&
      previous.start === current.start;
    const overlapsPreviousRange = previous.end > previous.start && current.start < previous.end;
    const insertsInsidePreviousRange =
      previous.end > previous.start &&
      current.start === current.end &&
      current.start > previous.start &&
      current.start < previous.end;
    if (duplicateInsertion || overlapsPreviousRange || insertsInsidePreviousRange) {
      throw new Error("Hashline edits contain overlapping or ambiguous targets.");
    }
  }
}

function stripAccidentalPrefixes(lines: string[], validRefs: Set<string>): string[] {
  return lines.map((line) => {
    const match = HASHLINE_LINE_PATTERN.exec(line);
    const ref = match?.groups?.ref;
    return ref && validRefs.has(ref) ? (match.groups?.content ?? "") : line;
  });
}

function compareEditsDescending(left: ResolvedEdit, right: ResolvedEdit): number {
  return right.start - left.start || right.end - left.end;
}

function splitTextLines(text: string): { hasTrailingNewline: boolean; lines: string[] } {
  if (!text) return { hasTrailingNewline: false, lines: [] };
  const hasTrailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (hasTrailingNewline) lines.pop();
  return { hasTrailingNewline, lines };
}

function joinTextLines(lines: string[], hasTrailingNewline: boolean): string {
  if (!lines.length) return "";
  return `${lines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}
