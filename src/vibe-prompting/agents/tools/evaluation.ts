/** Exposes evaluation execution through a framework-neutral agent tool without owning prompt operations. */

import { z } from "zod";

import { criteriaSchema } from "../../evaluation/api.ts";
import type { EvaluationRuns } from "../../evaluation/runs/index.ts";
import { type AgentTool, defineAgentTool, requireAgentActor } from "./api.ts";

/** Identifies configured models by either their canonical ID or display label. */
export type ConfiguredModelReference = { id: string; label: string };

const evaluationCaseSchema = z.object({
  input: z.string().trim().min(1).describe("Input sent to the Target."),
  criteria: criteriaSchema.describe("Criterion definitions used to judge this case."),
});
const batchConfigurationSchema = z.object({
  name: z.string().trim().min(1).describe("Human-readable matrix configuration name."),
  criteria: criteriaSchema.describe("Criterion definitions shared by this configuration."),
});
const evaluationSchema = z.object({
  promptId: z.uuid().describe("Saved prompt ID."),
  promptRevisionId: z.uuid().describe("Exact prompt revision ID to evaluate."),
  targetModelId: z.string().trim().min(1).describe("Configured target model ID or display label."),
  targetModelIds: z
    .array(z.string().trim().min(1).describe("Configured target model ID or display label."))
    .min(1)
    .max(6)
    .optional()
    .describe("Target models used for matrix execution."),
  judges: z
    .array(z.string().trim().min(1).describe("Configured judge model ID or display label."))
    .min(1)
    .max(3)
    .describe("Independent judge models used for every case."),
  batchConfigurations: z
    .array(batchConfigurationSchema)
    .min(1)
    .max(6)
    .optional()
    .describe("Named Criteria configurations for matrix execution."),
  cases: z.array(evaluationCaseSchema).min(1).max(3).describe("Evaluation cases."),
  repetitions: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Execution count for each matrix combination."),
});

/** Adapts the agent's compact evaluation input into persisted single runs or batches. */
export function createEvaluationTool(
  evaluations: EvaluationRuns,
  loadModels: () => Promise<readonly ConfiguredModelReference[]>,
): AgentTool {
  return defineAgentTool({
    name: "evaluate",
    title: "Start evaluation",
    description:
      "Start a durable evaluation for one exact prompt revision across supplied cases and judge models. Optional target models, Criteria configurations, or repetitions expand the request into a persisted evaluation matrix.",
    parameters: evaluationSchema,
    annotations: { destructiveHint: false, openWorldHint: true },
    async execute(
      {
        promptId,
        promptRevisionId,
        targetModelId,
        targetModelIds,
        judges,
        batchConfigurations,
        cases,
        repetitions,
      },
      context,
    ) {
      const { actorUserId, chatId } = requireAgentActor(context);
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
            id: run.id,
            kind: "evaluation",
            href: `/evaluations/${run.id}`,
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
        artifact: { id: run.id, kind: "evaluation", href: `/evaluations/${run.id}` },
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
