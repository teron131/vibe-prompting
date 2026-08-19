/** Owns the isolated prompt workspace and the only filesystem tools exposed to the editing agent. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import { applySingleFilePatch } from "./apply-patch.ts";

const RUNS_ROOT = resolve(".cache/prompt-agent-runs");
const PROMPT_PATH = "prompt.md";

export type PromptWorkspace = {
  applyPatch(patch: string): Promise<string>;
  dispose(): Promise<void>;
  read(): Promise<string>;
};

export async function createPromptWorkspace(markdown: string): Promise<PromptWorkspace> {
  const runDirectory = resolve(RUNS_ROOT, randomUUID());
  if (!runDirectory.startsWith(`${RUNS_ROOT}/`)) {
    throw new Error("Unable to create a safe prompt workspace.");
  }

  await mkdir(RUNS_ROOT, { recursive: true });
  await mkdir(runDirectory);
  const promptPath = resolve(runDirectory, PROMPT_PATH);
  await writeFile(promptPath, markdown, { encoding: "utf8", flag: "wx" });

  return {
    async applyPatch(patch) {
      const originalText = await readFile(promptPath, "utf8");
      const updatedText = applySingleFilePatch({
        originalText,
        patchText: patch,
        targetPath: PROMPT_PATH,
      });
      const temporaryPath = resolve(runDirectory, `.prompt-${randomUUID()}.tmp`);
      await writeFile(temporaryPath, updatedText, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, promptPath);
      return updatedText;
    },
    async dispose() {
      await rm(runDirectory, { recursive: true, force: true });
    },
    async read() {
      return readFile(promptPath, "utf8");
    },
  };
}

export function createScopedFsTools(workspace: PromptWorkspace): Tool[] {
  return [
    tool({
      name: "read_prompt",
      description: "Read the complete current contents of prompt.md before deciding what to patch.",
      parameters: z.object({}),
      async execute() {
        return workspace.read();
      },
    }),
    tool({
      name: "apply_patch",
      description: "Apply one single-file *** Begin Patch update to prompt.md.",
      parameters: z.object({
        patch: z.string().min(1).describe("Patch text whose only update-file target is prompt.md."),
      }),
      async execute({ patch }) {
        await workspace.applyPatch(patch);
        return "Patched prompt.md. Read it again before making another change.";
      },
    }),
  ];
}
