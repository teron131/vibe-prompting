/** Materializes one isolated prompt file and exposes only exact reads and replacements for an agent run. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUNS_ROOT = resolve(".cache/agent-runs");

export type PromptWorkspace = {
  dispose(): Promise<void>;
  read(): Promise<string>;
  replaceExact(oldText: string, newText: string): Promise<string>;
};

export async function createPromptWorkspace(markdown: string): Promise<PromptWorkspace> {
  const runDirectory = resolve(RUNS_ROOT, randomUUID());
  if (!runDirectory.startsWith(`${RUNS_ROOT}/`)) {
    throw new Error("Unable to create a safe prompt workspace.");
  }

  await mkdir(RUNS_ROOT, { recursive: true });
  await mkdir(runDirectory);
  const promptPath = resolve(runDirectory, "prompt.md");
  await writeFile(promptPath, markdown, { encoding: "utf8", flag: "wx" });

  return {
    async dispose() {
      await rm(runDirectory, { recursive: true, force: true });
    },
    async read() {
      return readFile(promptPath, "utf8");
    },
    async replaceExact(oldText, newText) {
      if (oldText.length === 0) {
        throw new Error("oldText must contain the exact text to replace.");
      }
      const current = await readFile(promptPath, "utf8");
      const firstMatch = current.indexOf(oldText);
      if (firstMatch === -1) {
        throw new Error("oldText was not found in prompt.md. Read the prompt again and retry.");
      }
      if (current.indexOf(oldText, firstMatch + oldText.length) !== -1) {
        throw new Error(
          "oldText occurs more than once in prompt.md. Include more surrounding text.",
        );
      }

      const updated = `${current.slice(0, firstMatch)}${newText}${current.slice(firstMatch + oldText.length)}`;
      const temporaryPath = resolve(runDirectory, `.prompt-${randomUUID()}.tmp`);
      await writeFile(temporaryPath, updated, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, promptPath);
      return updated;
    },
  };
}
