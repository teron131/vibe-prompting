/** Creates the only filesystem tools exposed to the agent, both bound to one temporary prompt file. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import type { PromptWorkspace } from "../artifacts.ts";

export function createScopedFsTools(workspace: PromptWorkspace): Tool[] {
  return [
    tool({
      name: "read_prompt",
      description: "Read the complete current contents of prompt.md before deciding what to edit.",
      parameters: z.object({}),
      async execute() {
        return workspace.read();
      },
    }),
    tool({
      name: "edit_prompt",
      description:
        "Replace one exact, uniquely occurring passage in prompt.md. Include enough surrounding text in oldText to make the match unique.",
      parameters: z.object({
        newText: z.string().describe("Replacement Markdown, which may be empty to delete oldText."),
        oldText: z.string().min(1).describe("Exact existing Markdown to replace."),
      }),
      async execute({ newText, oldText }) {
        await workspace.replaceExact(oldText, newText);
        return "prompt.md was updated. Read it again before making another edit.";
      },
    }),
  ];
}
