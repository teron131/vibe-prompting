/** Retains the framework-neutral raw apply-patch engine as an inactive backup for prompt editing experiments; production prompt tools use Hashline instead. */

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

const PUNCTUATION_TRANSLATION = new Map([
  ["\u2010", "-"],
  ["\u2011", "-"],
  ["\u2012", "-"],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2015", "-"],
  ["\u2212", "-"],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201a", "'"],
  ["\u201b", "'"],
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u201e", '"'],
  ["\u201f", '"'],
  ["\u00a0", " "],
  ["\u2002", " "],
  ["\u2003", " "],
  ["\u2004", " "],
  ["\u2005", " "],
  ["\u2006", " "],
  ["\u2007", " "],
  ["\u2008", " "],
  ["\u2009", " "],
  ["\u200a", " "],
  ["\u202f", " "],
  ["\u205f", " "],
  ["\u3000", " "],
]);

type UpdateChunk = {
  changeContext?: string;
  isEndOfFile: boolean;
  newLines: string[];
  oldLines: string[];
};

type ParsedPatch = {
  chunks: UpdateChunk[];
  path: string;
};

type Replacement = {
  newLines: string[];
  oldLength: number;
  start: number;
};

type LineNormalizer = (value: string) => string;

const LINE_NORMALIZERS: LineNormalizer[] = [
  (value) => value,
  (value) => value.trimEnd(),
  (value) => value.trim(),
  (value) => normalizeWhitespace(value.trim()),
  (value) => normalizePunctuation(value.trim()),
  (value) => normalizeWhitespace(normalizePunctuation(value.trim())),
];

/** Applies one single-file OpenClaw-style patch to in-memory text while rejecting extra files, moves, empty patches, and unresolved context. */
export function applyPatchToText(originalText: string, patchText: string, targetPath: string) {
  const parsed = parseSingleFilePatch(patchText, targetPath);
  return applyChunks(originalText, parsed.path, parsed.chunks);
}

function parseSingleFilePatch(patchText: string, targetPath: string): ParsedPatch {
  const input = patchText.trim();
  if (!input) throw new Error("Patch input is empty.");
  const lines = input.split(/\r?\n/);
  if (lines[0]?.trim() !== BEGIN_PATCH_MARKER) {
    throw new Error(`The first line must be '${BEGIN_PATCH_MARKER}'.`);
  }
  if (lines.at(-1)?.trim() !== END_PATCH_MARKER) {
    throw new Error(`The last line must be '${END_PATCH_MARKER}'.`);
  }

  let index = 1;
  while (index < lines.length - 1 && lines[index]?.trim() === "") index += 1;
  const header = lines[index]?.trim() ?? "";
  if (!header.startsWith(UPDATE_FILE_MARKER)) {
    throw new Error(`Patch must contain exactly one '${UPDATE_FILE_MARKER}${targetPath}' hunk.`);
  }
  const path = normalizePath(header.slice(UPDATE_FILE_MARKER.length));
  if (path !== normalizePath(targetPath)) {
    throw new Error(`Patch targets '${path}', expected '${targetPath}'.`);
  }
  index += 1;
  if (lines[index]?.trim().startsWith(MOVE_TO_MARKER)) {
    throw new Error("Move operations are not supported.");
  }

  const chunks: UpdateChunk[] = [];
  while (index < lines.length - 1) {
    if (lines[index]?.trim() === "") {
      index += 1;
      continue;
    }
    if (lines[index]?.trim().startsWith("*** ")) {
      throw new Error("Patch must update exactly one file.");
    }
    const parsed = parseChunk(lines.slice(index, -1), chunks.length === 0);
    chunks.push(parsed.chunk);
    index += parsed.consumed;
  }
  if (!chunks.length) throw new Error("The update hunk is empty.");
  if (
    !chunks.some(
      (chunk) =>
        chunk.oldLines.length !== chunk.newLines.length ||
        chunk.oldLines.some((line, offset) => line !== chunk.newLines[offset]),
    )
  ) {
    throw new Error("Patch does not add or remove any content.");
  }
  return { chunks, path };
}

function parseChunk(lines: string[], allowMissingContext: boolean) {
  if (!lines.length) throw new Error("Update hunk does not contain any lines.");
  let index = 0;
  let changeContext: string | undefined;
  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    index = 1;
  } else if (lines[0]?.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    index = 1;
  } else if (!allowMissingContext) {
    throw new Error(`Expected an @@ context marker, got '${lines[0]}'.`);
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let isEndOfFile = false;
  let parsedLines = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === EOF_MARKER) {
      if (!parsedLines) throw new Error("Update hunk does not contain any lines.");
      isEndOfFile = true;
      index += 1;
      break;
    }
    if (isChunkBoundary(line)) break;
    if (line === "") {
      oldLines.push("");
      newLines.push("");
    } else if (line[0] === " ") {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (line[0] === "+") {
      newLines.push(line.slice(1));
    } else if (line[0] === "-") {
      oldLines.push(line.slice(1));
    } else {
      if (!parsedLines) {
        throw new Error(`Invalid patch line '${line}'. Lines must start with a space, +, or -.`);
      }
      break;
    }
    parsedLines += 1;
    index += 1;
  }
  if (!parsedLines) throw new Error("Update hunk does not contain any lines.");
  return {
    chunk: { changeContext, isEndOfFile, newLines, oldLines },
    consumed: index,
  };
}

function applyChunks(originalText: string, path: string, chunks: UpdateChunk[]) {
  const hasTrailingNewline = originalText.endsWith("\n");
  const originalLines = originalText.split("\n");
  if (originalLines.at(-1) === "") originalLines.pop();
  const replacements = computeReplacements(originalLines, path, chunks);
  const result = [...originalLines];
  for (const replacement of replacements.toReversed()) {
    result.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
  }
  if (!result.length) return "";
  return `${result.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

function computeReplacements(lines: string[], path: string, chunks: UpdateChunk[]) {
  const replacements: Replacement[] = [];
  let lineIndex = 0;
  for (const chunk of chunks) {
    if (chunk.changeContext !== undefined) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === undefined) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}.`);
      }
      lineIndex = contextIndex + 1;
    }

    if (!chunk.oldLines.length) {
      replacements.push({ newLines: chunk.newLines, oldLength: 0, start: lines.length });
      continue;
    }
    let oldLines = chunk.oldLines;
    let newLines = chunk.newLines;
    let found = seekSequence(lines, oldLines, lineIndex, chunk.isEndOfFile);
    if (found === undefined && oldLines.at(-1) === "") {
      oldLines = oldLines.slice(0, -1);
      if (newLines.at(-1) === "") newLines = newLines.slice(0, -1);
      found = seekSequence(lines, oldLines, lineIndex, chunk.isEndOfFile);
    }
    if (found === undefined) {
      throw new Error(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`);
    }
    replacements.push({ newLines, oldLength: oldLines.length, start: found });
    lineIndex = found + oldLines.length;
  }
  return replacements.sort((left, right) => left.start - right.start);
}

/** Searches from strict to increasingly normalized comparisons so the backup parser tolerates punctuation and whitespace drift without ignoring line order. */
function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean) {
  if (!pattern.length) return start;
  if (pattern.length > lines.length) return undefined;
  const maximumStart = lines.length - pattern.length;
  const searchStart = eof ? maximumStart : start;
  if (searchStart > maximumStart) return undefined;
  for (const normalize of LINE_NORMALIZERS) {
    for (let index = searchStart; index <= maximumStart; index += 1) {
      if (
        pattern.every(
          (expected, offset) => normalize(lines[index + offset]) === normalize(expected),
        )
      ) {
        return index;
      }
    }
  }
  return undefined;
}

function isChunkBoundary(line: string) {
  return (
    line === EMPTY_CHANGE_CONTEXT_MARKER ||
    line.startsWith(CHANGE_CONTEXT_MARKER) ||
    line.trim().startsWith("*** ")
  );
}

function normalizePath(path: string) {
  return path.trim().replace(/^\/+/, "");
}

function normalizePunctuation(value: string) {
  return [...value]
    .map((character) => PUNCTUATION_TRANSLATION.get(character) ?? character)
    .join("");
}

function normalizeWhitespace(value: string) {
  return value.split(/\s+/).filter(Boolean).join(" ");
}
