/** Owns the toolkit that exposes durable Prompt System operations to agent runtimes. */

import { z } from "zod";

import {
  PromptConflictError,
  type PromptSystem,
  type StoredPrompt,
} from "../../prompt-system/index.ts";
import { AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";
import {
  applyPromptHashlineEdits,
  formatPromptHashlines,
  promptHashlineEditsSchema,
} from "./hashline.ts";

const promptEditRequestSchema = z.object({
  promptId: z.uuid().describe("Saved prompt ID."),
  expectedRevisionId: z.uuid().describe("Active revision ID expected by this edit."),
  changeRequest: z.string().trim().min(1).describe("Concise reason for the revision."),
  edits: promptHashlineEditsSchema,
});

export class PromptLibraryToolkit extends AgentToolkit {
  constructor(prompts: PromptSystem) {
    super("prompt-library", [
      defineAgentTool({
        name: "list_prompts",
        title: "List prompts",
        description:
          "List all saved prompts at their active revisions, including stable prompt IDs, active revision IDs, titles, revision counts, and update times.",
        parameters: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute() {
          return {
            prompts: (await prompts.listPrompts()).map((prompt) => projectStoredPrompt(prompt)),
          };
        },
      }),
      defineAgentTool({
        name: "read_prompt",
        title: "Read prompt",
        description:
          "Read one saved prompt's active revision with current LINE#HASH physical-line references for structured editing.",
        parameters: z.object({ promptId: z.uuid().describe("Saved prompt ID.") }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ promptId }) {
          const prompt = await prompts.getPrompt(promptId);
          return {
            ...projectStoredPrompt(prompt),
            content: formatPromptHashlines(prompt.markdown),
          };
        },
      }),
      defineAgentTool({
        name: "search_prompts",
        title: "Search prompts",
        description:
          "Search saved prompt titles and active-revision passages, returning matching prompt summaries with ranked passage excerpts.",
        parameters: z.object({
          query: z.string().trim().min(2).max(200).describe("Prompt title or passage query."),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ query }) {
          return {
            prompts: (await prompts.searchPrompts(query)).map(
              ({ markdown: _markdown, ...prompt }) => prompt,
            ),
          };
        },
      }),
      defineAgentTool({
        name: "create_prompt",
        title: "Create prompt",
        description: "Create a saved prompt and its initial immutable Markdown revision.",
        parameters: z.object({
          title: z.string().trim().min(1).describe("Human-readable prompt title."),
          markdown: z.string().min(1).describe("Complete initial prompt Markdown."),
        }),
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute(input, context) {
          const { actorUserId } = requireAgentActor(context);
          const prompt = await prompts.createPrompt(actorUserId, input);
          return promptResult(prompt, "Created prompt.");
        },
      }),
      defineAgentTool({
        name: "edit_prompt",
        title: "Edit prompt",
        description:
          "Append one immutable AI-authored revision by applying an atomic batch of replace_range, insert_before, insert_after, or append operations addressed by current LINE#HASH refs. Edit content contains complete physical lines without refs.",
        parameters: promptEditRequestSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute(input, context) {
          const { actorUserId } = requireAgentActor(context);
          const saved = await editStoredPrompt(prompts, actorUserId, input);
          return promptResult(saved, "Updated prompt.");
        },
      }),
    ]);
  }
}

async function editStoredPrompt(
  prompts: PromptSystem,
  actorUserId: string,
  { changeRequest, edits, expectedRevisionId, promptId }: z.infer<typeof promptEditRequestSchema>,
): Promise<StoredPrompt> {
  const active = await prompts.getPrompt(promptId);
  if (active.activeRevisionId !== expectedRevisionId) {
    throw new PromptConflictError(active.activeRevisionId);
  }
  const editedMarkdown = applyPromptHashlineEdits(active.markdown, edits);
  return prompts.appendAiEdit(actorUserId, {
    promptId,
    expectedActiveRevisionId: expectedRevisionId,
    visibleMarkdown: active.markdown,
    instruction: changeRequest,
    editedMarkdown,
  });
}

export function projectStoredPrompt(prompt: StoredPrompt, includeMarkdown = false) {
  return {
    id: prompt.id,
    revisionId: prompt.revisionId,
    title: prompt.title,
    ...(includeMarkdown && { markdown: prompt.markdown }),
    revisionCount: prompt.revisionCount,
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
    id: prompt.id,
    kind: "prompt",
    revisionId: prompt.revisionId,
    title: prompt.title,
    href: `/prompts/${prompt.id}`,
  };
}
