/** Adapts the evaluation capability into a general-agent tool without owning prompt operations. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import type { EvaluationRuns } from "../../evaluation/runs.ts";

export type ConfiguredModelReference = { id: string; label: string };

const evaluationCaseSchema = z.object({
  input: z.string().trim().min(1),
  criteria: z.array(z.string().trim().min(1)).min(1).max(4),
});
const evaluationSchema = z.object({
  cases: z.array(evaluationCaseSchema).min(1).max(3),
  judges: z
    .array(z.string().trim().min(1).describe("Configured judge model ID or display label."))
    .min(1)
    .max(3),
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  targetModelId: z.string().trim().min(1).describe("Configured target model ID or display label."),
});

export function createEvaluationTool(
  evaluations: EvaluationRuns,
  chatId: string,
  loadModels: () => Promise<readonly ConfiguredModelReference[]>,
): Tool {
  return tool({
    name: "evaluate",
    description: "Start one persisted evaluation run with the supplied target and criteria.",
    parameters: evaluationSchema,
    async execute({ cases, judges, promptId, promptRevisionId, targetModelId }) {
      const models = await loadModels();
      const run = await evaluations.startAgentRun(
        {
          cases: cases.map((testCase) => ({
            criteria: testCase.criteria.map((instruction) => ({
              type: "boolean" as const,
              instruction,
            })),
            input: testCase.input,
          })),
          judges: judges.map((judge) => resolveConfiguredModelId(judge, models)),
          promptId,
          promptRevisionId,
          targetModelId: resolveConfiguredModelId(targetModelId, models),
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

function resolveConfiguredModelId(
  reference: string,
  models: readonly ConfiguredModelReference[],
): string {
  const normalized = reference.trim().toLocaleLowerCase();
  const idMatch = models.find((model) => model.id.toLocaleLowerCase() === normalized);
  if (idMatch) return idMatch.id;
  const labelMatches = models.filter((model) => model.label.toLocaleLowerCase() === normalized);
  if (labelMatches.length === 1) return labelMatches[0].id;
  if (labelMatches.length > 1)
    throw new Error(`Configured model label is ambiguous: ${reference}. Use its model ID.`);
  throw new Error(`Unknown configured model: ${reference}.`);
}
