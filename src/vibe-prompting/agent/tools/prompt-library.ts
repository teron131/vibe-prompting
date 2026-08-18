/** Exposes durable prompt-library and evaluation operations to general chat runs without binding a conversation to one prompt. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import type { EvaluationRuns } from "../../evaluation/runs.ts";
import type { PromptStore, StoredPrompt } from "../../prompts/store.ts";

const evaluationCaseSchema = z.object({
  input: z.string().trim().min(1),
  criteria: z.array(z.string().trim().min(1)).min(1).max(4),
});

export function createPromptLibraryTools(prompts: PromptStore): Tool[] {
  return [
    tool({
      name: "list_prompts",
      description:
        "List saved prompts with their current revision IDs so another prompt tool can address the correct artifact.",
      parameters: z.object({}),
      async execute() {
        return (await prompts.listPrompts()).map((prompt) => projectPrompt(prompt));
      },
    }),
    tool({
      name: "read_prompt",
      description:
        "Read one saved prompt and its current revision before editing or evaluating it.",
      parameters: z.object({ promptId: z.uuid() }),
      async execute({ promptId }) {
        return projectPrompt(await prompts.getPrompt(promptId), true);
      },
    }),
    tool({
      name: "create_prompt",
      description:
        "Create a saved prompt artifact when the user asks to draft or store a new prompt.",
      parameters: z.object({
        markdown: z.string().min(1),
        title: z.string().trim().min(1),
      }),
      async execute(input) {
        return promptArtifact(await prompts.createPrompt(input), "Created prompt artifact.");
      },
    }),
    tool({
      name: "edit_prompt",
      description:
        "Replace one exact and uniquely occurring passage in a saved prompt after reading its current revision.",
      parameters: z.object({
        changeRequest: z.string().trim().min(1),
        expectedRevisionId: z.uuid(),
        newText: z.string(),
        oldText: z.string().min(1),
        promptId: z.uuid(),
      }),
      async execute({ changeRequest, expectedRevisionId, newText, oldText, promptId }) {
        const current = await prompts.getPrompt(promptId);
        if (current.revisionId !== expectedRevisionId)
          throw new Error("The prompt changed after it was read. Read it again before editing.");
        const first = current.markdown.indexOf(oldText);
        if (first < 0)
          throw new Error("The requested passage was not found in the current prompt.");
        if (current.markdown.indexOf(oldText, first + oldText.length) >= 0)
          throw new Error(
            "The requested passage occurs more than once. Include more surrounding text.",
          );
        const editedMarkdown = `${current.markdown.slice(0, first)}${newText}${current.markdown.slice(first + oldText.length)}`;
        const saved = await prompts.appendAgentEdit({
          editedMarkdown,
          expectedRevisionId,
          instruction: changeRequest,
          promptId,
          visibleMarkdown: current.markdown,
        });
        return promptArtifact(saved, "Updated prompt artifact.");
      },
    }),
  ];
}

export function createPersistedEvaluationTool(evaluations: EvaluationRuns, chatId: string): Tool {
  return tool({
    name: "evaluate_prompt",
    description:
      "Start a persisted evaluation for one exact saved-prompt revision when the user asks to test, evaluate, validate, or optimize prompt behavior.",
    parameters: z.object({
      cases: z.array(evaluationCaseSchema).min(1).max(3),
      judges: z.array(z.string().trim().min(1)).min(1).max(3),
      promptId: z.uuid(),
      promptRevisionId: z.uuid(),
      targetModelId: z.string().trim().min(1),
    }),
    async execute({ cases, judges, promptId, promptRevisionId, targetModelId }) {
      const run = await evaluations.startAgentRun(
        {
          cases: cases.map((testCase) => ({
            criteria: testCase.criteria.map((instruction) => ({
              type: "boolean" as const,
              instruction,
            })),
            input: testCase.input,
          })),
          judges,
          promptId,
          promptRevisionId,
          targetModelId,
        },
        chatId,
      );
      return {
        artifact: { href: `/evaluations/${run.id}`, id: run.id, kind: "evaluation" },
        run,
        summary: "Started persisted evaluation run.",
      };
    },
  });
}

function projectPrompt(prompt: StoredPrompt, includeMarkdown = false) {
  return {
    id: prompt.id,
    ...(includeMarkdown && { markdown: prompt.markdown }),
    revisionCount: prompt.revisionCount,
    revisionId: prompt.revisionId,
    title: prompt.title,
    updatedAt: prompt.updatedAt,
  };
}

function promptArtifact(prompt: StoredPrompt, summary: string) {
  return {
    artifact: {
      href: `/prompts/${prompt.id}`,
      id: prompt.id,
      kind: "prompt",
      revisionId: prompt.revisionId,
      title: prompt.title,
    },
    prompt: projectPrompt(prompt, true),
    summary,
  };
}
