/** Exposes evaluation execution through a framework-neutral agent tool without owning prompt operations. */

import { z } from "zod";

import { criteriaSchema } from "../../evaluation/api.ts";
import type { EvaluationRuns } from "../../evaluation/runs/index.ts";
import { type AgentTool, defineAgentTool } from "./api.ts";

/** Identifies configured models by either their canonical ID or display label. */
export type ConfiguredModelReference = { id: string; label: string };

const evaluationCaseSchema = z.object({
  input: z.string().trim().min(1),
  criteria: criteriaSchema,
});
const batchConfigurationSchema = z.object({
  name: z.string().trim().min(1),
  criteria: criteriaSchema,
});
const evaluationSchema = z.object({
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  targetModelId: z.string().trim().min(1).describe("Configured target model ID or display label."),
  targetModelIds: z
    .array(z.string().trim().min(1).describe("Configured target model ID or display label."))
    .min(1)
    .max(6)
    .optional(),
  judges: z
    .array(z.string().trim().min(1).describe("Configured judge model ID or display label."))
    .min(1)
    .max(3),
  batchConfigurations: z.array(batchConfigurationSchema).min(1).max(6).optional(),
  cases: z.array(evaluationCaseSchema).min(1).max(3),
  repetitions: z.number().int().min(1).max(5).optional(),
});

/** Adapts the agent's compact evaluation input into persisted single runs or batches. */
export function createEvaluationTool(
  evaluations: EvaluationRuns,
  actorUserId: string,
  chatId: string,
  loadModels: () => Promise<readonly ConfiguredModelReference[]>,
): AgentTool {
  return defineAgentTool({
    name: "evaluate",
    description:
      "Start one persisted evaluation run, or preview and start a matrix when batchConfigurations, targetModelIds, or repetitions are supplied.",
    parameters: evaluationSchema,
    async execute({
      promptId,
      promptRevisionId,
      targetModelId,
      targetModelIds,
      judges,
      batchConfigurations,
      cases,
      repetitions,
    }) {
      const models = await loadModels();
      if (batchConfigurations || targetModelIds || repetitions) {
        const inheritedCriteria = cases[0]?.criteria ?? [];
        if (
          !batchConfigurations &&
          cases.some(
            ({ criteria }) => JSON.stringify(criteria) !== JSON.stringify(inheritedCriteria),
          )
        ) {
          throw new Error(
            "Batch evaluation cases must share criteria or provide explicit batchConfigurations.",
          );
        }
        const batchInput = {
          promptId,
          promptRevisionId,
          targetModelIds: (targetModelIds ?? [targetModelId]).map((model) =>
            resolveConfiguredModelId(model, models),
          ),
          judges: judges.map((judge) => resolveConfiguredModelId(judge, models)),
          configurations: (
            batchConfigurations ?? [{ name: "Default", criteria: inheritedCriteria }]
          ).map((configuration, index) => ({
            id: `configuration-${index + 1}`,
            name: configuration.name,
            criteria: configuration.criteria,
          })),
          cases: cases.map(({ input }) => ({ input })),
          repetitions: repetitions ?? 1,
        };
        const preview = await evaluations.previewBatch(batchInput);
        const batch = await evaluations.startAgentBatch(actorUserId, batchInput, chatId);
        return {
          artifacts: batch.runs.map((run) => ({
            href: `/evaluations/${run.id}`,
            id: run.id,
            kind: "evaluation",
          })),
          preview,
          runs: batch.runs,
          summary: `Started ${batch.runs.length} persisted evaluation executions.`,
        };
      }
      const run = await evaluations.startAgentRun(
        actorUserId,
        {
          promptId,
          promptRevisionId,
          targetModelId: resolveConfiguredModelId(targetModelId, models),
          judges: judges.map((judge) => resolveConfiguredModelId(judge, models)),
          cases: cases.map((testCase) => ({
            input: testCase.input,
            criteria: testCase.criteria,
          })),
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

/** Resolves a model ID or unique display label and rejects unknown or ambiguous references. */
export function resolveConfiguredModelId(
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
