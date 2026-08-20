/** Builds a compact, line-numbered prompt diff while retaining enough unchanged context to understand each edit. */

export type PromptDiffRow =
  | {
      kind: "added" | "context" | "removed";
      newLineNumber: number | null;
      oldLineNumber: number | null;
      segments?: PromptDiffSegment[];
      text: string;
    }
  | { hiddenLineCount: number; kind: "collapsed" };

export type PromptDiffSegment = { kind: "changed" | "unchanged"; text: string };

const CONTEXT_LINE_COUNT = 3;
const DIFF_MATRIX_LIMIT = 60_000;
const INLINE_DIFF_MATRIX_LIMIT = 40_000;

export function buildPromptDiff(before: string, after: string): PromptDiffRow[] {
  if (before === after) return [];
  return collapseContext(numberLines(addInlineDiffs(diffLines(before, after))));
}

type RawDiffLine = {
  kind: "added" | "context" | "removed";
  segments?: PromptDiffSegment[];
  text: string;
};
type NumberedDiffLine = Exclude<PromptDiffRow, { kind: "collapsed" }>;

function diffLines(before: string, after: string): RawDiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);
  if (left.length * right.length > DIFF_MATRIX_LIMIT) {
    return [
      ...left.map((text) => ({ kind: "removed" as const, text })),
      ...right.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + lengths[leftIndex + 1]![rightIndex + 1]!
          : Math.max(lengths[leftIndex + 1]![rightIndex]!, lengths[leftIndex]![rightIndex + 1]!);
    }
  }
  const result: RawDiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      result.push({ kind: "context", text: left[leftIndex]! });
      leftIndex += 1;
      rightIndex += 1;
    } else if (lengths[leftIndex + 1]![rightIndex]! >= lengths[leftIndex]![rightIndex + 1]!) {
      result.push({ kind: "removed", text: left[leftIndex]! });
      leftIndex += 1;
    } else {
      result.push({ kind: "added", text: right[rightIndex]! });
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) result.push({ kind: "removed", text: left[leftIndex++]! });
  while (rightIndex < right.length) result.push({ kind: "added", text: right[rightIndex++]! });
  return result;
}

function splitLines(markdown: string): string[] {
  return markdown === "" ? [] : markdown.split("\n");
}

function addInlineDiffs(lines: RawDiffLine[]): RawDiffLine[] {
  const result = lines.map((line) => ({ ...line }));
  let index = 0;
  while (index < result.length) {
    if (result[index]!.kind !== "removed") {
      index += 1;
      continue;
    }
    const removedStart = index;
    while (index < result.length && result[index]!.kind === "removed") index += 1;
    const addedStart = index;
    while (index < result.length && result[index]!.kind === "added") index += 1;
    const pairCount = Math.min(addedStart - removedStart, index - addedStart);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const removed = result[removedStart + pairIndex]!;
      const added = result[addedStart + pairIndex]!;
      const [removedSegments, addedSegments] = diffWords(removed.text, added.text);
      removed.segments = removedSegments;
      added.segments = addedSegments;
    }
  }
  return result;
}

function diffWords(before: string, after: string): [PromptDiffSegment[], PromptDiffSegment[]] {
  const left = tokenizeInlineDiff(before);
  const right = tokenizeInlineDiff(after);
  if (left.length * right.length > INLINE_DIFF_MATRIX_LIMIT) {
    return [changedSegment(before), changedSegment(after)];
  }
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + lengths[leftIndex + 1]![rightIndex + 1]!
          : Math.max(lengths[leftIndex + 1]![rightIndex]!, lengths[leftIndex]![rightIndex + 1]!);
    }
  }
  const removed: PromptDiffSegment[] = [];
  const added: PromptDiffSegment[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      appendSegment(removed, "unchanged", left[leftIndex]!);
      appendSegment(added, "unchanged", right[rightIndex]!);
      leftIndex += 1;
      rightIndex += 1;
    } else if (lengths[leftIndex + 1]![rightIndex]! >= lengths[leftIndex]![rightIndex + 1]!) {
      appendSegment(removed, "changed", left[leftIndex++]!);
    } else {
      appendSegment(added, "changed", right[rightIndex++]!);
    }
  }
  while (leftIndex < left.length) appendSegment(removed, "changed", left[leftIndex++]!);
  while (rightIndex < right.length) appendSegment(added, "changed", right[rightIndex++]!);
  return [removed, added];
}

function tokenizeInlineDiff(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+/gu) ?? [];
}

function appendSegment(
  segments: PromptDiffSegment[],
  kind: PromptDiffSegment["kind"],
  text: string,
) {
  const previous = segments.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else segments.push({ kind, text });
}

function changedSegment(text: string): PromptDiffSegment[] {
  return text === "" ? [] : [{ kind: "changed", text }];
}

function numberLines(lines: RawDiffLine[]): NumberedDiffLine[] {
  let newLineNumber = 1;
  let oldLineNumber = 1;
  return lines.map((line) => {
    const numbered = {
      ...line,
      newLineNumber: line.kind === "removed" ? null : newLineNumber,
      oldLineNumber: line.kind === "added" ? null : oldLineNumber,
    };
    if (line.kind !== "added") oldLineNumber += 1;
    if (line.kind !== "removed") newLineNumber += 1;
    return numbered;
  });
}

function collapseContext(lines: NumberedDiffLine[]): PromptDiffRow[] {
  const result: PromptDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind !== "context") {
      result.push(lines[index]!);
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && lines[index]!.kind === "context") index += 1;
    const run = lines.slice(start, index);
    const leading = start === 0;
    const trailing = index === lines.length;
    const prefixCount = leading ? 0 : Math.min(CONTEXT_LINE_COUNT, run.length);
    const suffixCount = trailing ? 0 : Math.min(CONTEXT_LINE_COUNT, run.length - prefixCount);
    const hiddenLineCount = run.length - prefixCount - suffixCount;
    result.push(...run.slice(0, prefixCount));
    if (hiddenLineCount > 0) result.push({ hiddenLineCount, kind: "collapsed" });
    if (suffixCount > 0) result.push(...run.slice(run.length - suffixCount));
  }
  return result;
}
