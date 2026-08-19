/** Parses and applies bounded single-file patches for prompt-editing tools without filesystem access. */

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const UPDATE_FILE = "*** Update File: ";
const END_OF_FILE = "*** End of File";

type PatchChunk = {
  context: string | null;
  newLines: string[];
  oldLines: string[];
  atEnd: boolean;
};

type Replacement = {
  index: number;
  insert: string[];
  remove: number;
};

export function applySingleFilePatch(input: {
  originalText: string;
  patchText: string;
  targetPath: string;
}): string {
  const chunks = parsePatch(input.patchText, input.targetPath);
  const trailingNewline = input.originalText.endsWith("\n");
  const lines = input.originalText.split("\n");
  if (lines.at(-1) === "") lines.pop();

  const replacements = resolveReplacements(lines, chunks, input.targetPath);
  const updated = [...lines];
  for (const replacement of replacements.toReversed()) {
    updated.splice(replacement.index, replacement.remove, ...replacement.insert);
  }
  if (updated.length === 0) return "";
  return `${updated.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function parsePatch(patchText: string, targetPath: string): PatchChunk[] {
  const lines = patchText.trim().split(/\r?\n/);
  if (lines[0]?.trim() !== BEGIN_PATCH) {
    throw new Error(`Patch must start with ${JSON.stringify(BEGIN_PATCH)}.`);
  }
  if (lines.at(-1)?.trim() !== END_PATCH) {
    throw new Error(`Patch must end with ${JSON.stringify(END_PATCH)}.`);
  }

  let index = 1;
  while (index < lines.length - 1 && !lines[index]?.trim()) index += 1;
  const updateHeader = lines[index]?.trim();
  if (!updateHeader?.startsWith(UPDATE_FILE)) {
    throw new Error("Patch must contain one update-file section.");
  }
  const actualPath = normalizePath(updateHeader.slice(UPDATE_FILE.length));
  const expectedPath = normalizePath(targetPath);
  if (actualPath !== expectedPath) {
    throw new Error(
      `Patch targets ${JSON.stringify(actualPath)}, expected ${JSON.stringify(expectedPath)}.`,
    );
  }
  index += 1;

  const chunks: PatchChunk[] = [];
  while (index < lines.length - 1) {
    while (index < lines.length - 1 && !lines[index]?.trim()) index += 1;
    if (index >= lines.length - 1) break;
    const marker = lines[index] ?? "";
    if (marker.trim().startsWith("*** ")) {
      throw new Error(`Unsupported patch section: ${JSON.stringify(marker.trim())}.`);
    }

    let context: string | null = null;
    if (marker === "@@") {
      index += 1;
    } else if (marker.startsWith("@@ ")) {
      context = marker.slice(3);
      index += 1;
    } else if (chunks.length > 0) {
      throw new Error("Each additional patch chunk must start with an @@ marker.");
    }

    const oldLines: string[] = [];
    const newLines: string[] = [];
    let atEnd = false;
    let changes = 0;
    while (index < lines.length - 1) {
      const line = lines[index] ?? "";
      if (line === "@@" || line.startsWith("@@ ") || line.trim().startsWith("*** ")) break;
      if (!line) throw new Error("Patch lines must start with a space, +, or -.");
      const text = line.slice(1);
      if (line[0] === " ") {
        oldLines.push(text);
        newLines.push(text);
      } else if (line[0] === "-") {
        oldLines.push(text);
        changes += 1;
      } else if (line[0] === "+") {
        newLines.push(text);
        changes += 1;
      } else {
        throw new Error(`Invalid patch line prefix ${JSON.stringify(line[0])}.`);
      }
      index += 1;
    }
    if (lines[index]?.trim() === END_OF_FILE) {
      atEnd = true;
      index += 1;
    }
    if (changes === 0) throw new Error("Patch chunk must add or remove at least one line.");
    chunks.push({ atEnd, context, newLines, oldLines });
  }

  if (chunks.length === 0) throw new Error("Patch contains no changes.");
  return chunks;
}

function resolveReplacements(
  lines: string[],
  chunks: PatchChunk[],
  targetPath: string,
): Replacement[] {
  const replacements: Replacement[] = [];
  let cursor = 0;

  for (const chunk of chunks) {
    if (chunk.context !== null) {
      const contextIndex = findSequence(lines, [chunk.context], cursor, false);
      if (contextIndex === null) {
        throw new Error(
          `Failed to find context ${JSON.stringify(chunk.context)} in ${targetPath}.`,
        );
      }
      cursor = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push({ index: lines.length, insert: chunk.newLines, remove: 0 });
      cursor = lines.length;
      continue;
    }
    const matchIndex = findSequence(lines, chunk.oldLines, cursor, chunk.atEnd);
    if (matchIndex === null) {
      throw new Error(
        `Failed to find expected lines in ${targetPath}:\n${chunk.oldLines.join("\n")}`,
      );
    }
    replacements.push({ index: matchIndex, insert: chunk.newLines, remove: chunk.oldLines.length });
    cursor = matchIndex + chunk.oldLines.length;
  }

  return replacements;
}

function findSequence(
  lines: string[],
  expected: string[],
  start: number,
  atEnd: boolean,
): number | null {
  const lastStart = lines.length - expected.length;
  if (lastStart < 0) return null;
  const searchStart = atEnd ? lastStart : start;
  for (const normalize of NORMALIZERS) {
    for (let index = searchStart; index <= lastStart; index += 1) {
      if (
        expected.every((line, offset) => normalize(lines[index + offset] ?? "") === normalize(line))
      ) {
        return index;
      }
    }
  }
  return null;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

function normalizeWhitespace(value: string): string {
  return value.trim().split(/\s+/).join(" ");
}

function normalizePunctuation(value: string): string {
  return Array.from(value, (character) => PUNCTUATION_EQUIVALENTS[character] ?? character).join("");
}

const NORMALIZERS: Array<(value: string) => string> = [
  (value) => value,
  (value) => value.replace(/\s+$/u, ""),
  (value) => value.trim(),
  normalizeWhitespace,
  (value) => normalizePunctuation(value.trim()),
  (value) => normalizeWhitespace(normalizePunctuation(value)),
];

const PUNCTUATION_EQUIVALENTS: Record<string, string> = {
  "\u00a0": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  "\u202f": " ",
  "\u205f": " ",
  "\u2212": "-",
  "\u3000": " ",
};
