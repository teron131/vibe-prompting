/** Owns the in-memory prompt workspace and its framework-neutral document tools. */

import { z } from "zod";

import { type AgentTool, defineAgentTool } from "./api.ts";
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

export function createScopedFsTools(workspace: PromptWorkspace): AgentTool[] {
  return [
    defineAgentTool({
      name: "read_prompt",
      title: "Read working prompt",
      description:
        "Read the complete working prompt with current LINE#HASH physical-line references for structured editing.",
      parameters: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute() {
        return formatPromptHashlines(await workspace.read());
      },
    }),
    defineAgentTool({
      name: "edit_prompt",
      title: "Edit working prompt",
      description:
        "Update the in-memory working prompt with an atomic batch of replace_range, insert_before, insert_after, or append operations addressed by current LINE#HASH refs. Edit content contains complete physical lines without refs.",
      parameters: z.object({
        edits: promptHashlineEditsSchema,
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
      async execute({ edits }) {
        await workspace.applyEdits(edits);
        return "Updated the working prompt.";
      },
    }),
  ];
}
