/** Owns the in-memory prompt workspace and the only document tools exposed to the editing agent. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import {
  applyPromptHashlineEdits,
  formatPromptHashlines,
  type PromptHashlineEdit,
  promptHashlineEditsSchema,
} from "./hashline.ts";

export type PromptWorkspace = {
  applyEdits(edits: PromptHashlineEdit[]): Promise<string>;
  dispose(): Promise<void>;
  read(): Promise<string>;
};

export async function createPromptWorkspace(markdown: string): Promise<PromptWorkspace> {
  let currentMarkdown = markdown;

  return {
    async applyEdits(edits) {
      currentMarkdown = applyPromptHashlineEdits(currentMarkdown, edits);
      return currentMarkdown;
    },
    async dispose() {},
    async read() {
      return currentMarkdown;
    },
  };
}

export function createScopedFsTools(workspace: PromptWorkspace): Tool[] {
  return [
    tool({
      name: "read_prompt",
      description:
        "Read the complete current prompt as LINE#HASH:content physical lines before deciding what to edit.",
      parameters: z.object({}),
      async execute() {
        return formatPromptHashlines(await workspace.read());
      },
    }),
    tool({
      name: "edit_prompt",
      description:
        "Update the working prompt after read_prompt with structured replace_range, insert_before, insert_after, or append operations. Copy LINE#HASH refs exactly and send replacement content as complete physical lines without refs. All edits apply atomically against the latest read result. Never send diff or patch syntax.",
      parameters: z.object({
        edits: promptHashlineEditsSchema,
      }),
      async execute({ edits }) {
        await workspace.applyEdits(edits);
        return "Updated the working prompt.";
      },
    }),
  ];
}
