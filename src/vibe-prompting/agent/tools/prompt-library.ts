/** Adapts durable Prompt System operations into focused tools for general chat runs. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import {
  PromptConflictError,
  type PromptSystem,
  type StoredPrompt,
} from "../../prompt-system/index.ts";
import { applySingleFilePatch } from "./apply-patch.ts";

const promptPatchSchema = z.object({
  promptId: z.uuid(),
  changeRequest: z.string().trim().min(1),
  expectedRevisionId: z.uuid(),
  patch: z.string().min(1),
});

export function createPromptLibraryTools(prompts: PromptSystem): Tool[] {
  return [
    tool({
      name: "list_prompts",
      description:
        "List saved prompts with their current revision IDs so another prompt tool can address the correct revision.",
      parameters: z.object({}),
      async execute() {
        return (await prompts.listPrompts()).map((prompt) => projectStoredPrompt(prompt));
      },
    }),
    tool({
      name: "read_prompt",
      description: "Read one saved prompt and its current revision before editing it.",
      parameters: z.object({ promptId: z.uuid() }),
      async execute({ promptId }) {
        return projectStoredPrompt(await prompts.getPrompt(promptId), true);
      },
    }),
    tool({
      name: "search_prompts",
      description: "Search current saved prompt titles and passages before choosing one to read.",
      parameters: z.object({ query: z.string().trim().min(2).max(200) }),
      async execute({ query }) {
        return (await prompts.searchPrompts(query)).map(
          ({ markdown: _markdown, ...prompt }) => prompt,
        );
      },
    }),
    tool({
      name: "create_prompt",
      description: "Create a saved prompt when the user asks to draft or store markdown.",
      parameters: z.object({
        markdown: z.string().min(1),
        title: z.string().trim().min(1),
      }),
      async execute(input) {
        const prompt = await prompts.createPrompt(input);
        return promptResult(prompt, "Created prompt.");
      },
    }),
    tool({
      name: "patch_prompt",
      description: "Apply one single-file *** Begin Patch update to the current saved prompt.",
      parameters: promptPatchSchema,
      async execute(input) {
        const saved = await patchStoredPrompt(prompts, input);
        return promptResult(saved, "Updated prompt.");
      },
    }),
  ];
}

async function patchStoredPrompt(
  prompts: PromptSystem,
  { changeRequest, expectedRevisionId, patch, promptId }: z.infer<typeof promptPatchSchema>,
): Promise<StoredPrompt> {
  const current = await prompts.getPrompt(promptId);
  if (current.revisionId !== expectedRevisionId) throw new PromptConflictError();
  const editedMarkdown = applySingleFilePatch({
    originalText: current.markdown,
    patchText: patch,
    targetPath: "prompt.md",
  });
  return prompts.appendAiEdit({
    promptId,
    editedMarkdown,
    expectedRevisionId,
    instruction: changeRequest,
    visibleMarkdown: current.markdown,
  });
}

export function projectStoredPrompt(prompt: StoredPrompt, includeMarkdown = false) {
  return {
    ...(includeMarkdown && { markdown: prompt.markdown }),
    id: prompt.id,
    revisionCount: prompt.revisionCount,
    revisionId: prompt.revisionId,
    title: prompt.title,
    updatedAt: prompt.updatedAt,
  };
}

function promptResult(prompt: StoredPrompt, summary: string) {
  return {
    artifact: storedPromptLink(prompt),
    prompt: projectStoredPrompt(prompt, true),
    summary,
  };
}

export function storedPromptLink(prompt: StoredPrompt) {
  return {
    href: `/prompts/${prompt.id}`,
    id: prompt.id,
    kind: "prompt",
    revisionId: prompt.revisionId,
    title: prompt.title,
  };
}
