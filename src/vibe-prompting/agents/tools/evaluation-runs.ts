/** Owns the toolkit for starting, previewing, discovering, inspecting, and cancelling durable evaluation runs. */

import { z } from "zod";

import { evaluationBatchInputSchema, type EvaluationRuns } from "../../evaluation/runs/index.ts";
import { AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";
import { type ConfiguredModelReference, createEvaluationTool } from "./evaluation.ts";

const listSchema = z.object({
  promptId: z.uuid().optional().describe("Optional saved prompt ID filter."),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum runs to return."),
});
const runSchema = z.object({ runId: z.uuid().describe("Evaluation Run ID.") });

/** Keeps MCP and built-in agents on the same durable run lifecycle as website routes. */
export class EvaluationRunsToolkit extends AgentToolkit {
  constructor(
    evaluations: EvaluationRuns,
    loadModels: () => Promise<readonly ConfiguredModelReference[]>,
  ) {
    super("evaluation-runs", [
      defineAgentTool({
        name: "preview_evaluation_batch",
        title: "Preview evaluation batch",
        description:
          "Validate and expand an evaluation matrix into its exact durable-run, Target-invocation, and judge-score counts without starting execution.",
        parameters: evaluationBatchInputSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute(input) {
          return { preview: await evaluations.previewBatch(input) };
        },
      }),
      createEvaluationTool(evaluations, loadModels),
      defineAgentTool({
        name: "list_evaluation_runs",
        title: "List evaluation runs",
        description:
          "List recent durable Evaluation Run summaries and statuses, optionally filtered to one saved prompt.",
        parameters: listSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute(input, context) {
          const { actorUserId } = requireAgentActor(context);
          return { runs: await evaluations.listRuns(actorUserId, input) };
        },
      }),
      defineAgentTool({
        name: "read_evaluation_run",
        title: "Read evaluation run",
        description:
          "Read one durable Evaluation Run report with pinned provenance, cases, outputs, judge-attributed scores, and compatible Boolean history.",
        parameters: runSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const run = await evaluations.getRun(actorUserId, runId);
          const booleanTrend = await evaluations.getCompatibleBooleanTrend(runId);
          return {
            artifact: { id: run.id, kind: "evaluation", href: `/evaluations/${run.id}` },
            run,
            booleanTrend,
            summary: `Read evaluation run ${run.id}.`,
          };
        },
      }),
      defineAgentTool({
        name: "cancel_evaluation_run",
        title: "Cancel evaluation run",
        description:
          "Cancel one queued or running durable Evaluation Run while preserving its persisted evidence and terminal status.",
        parameters: runSchema,
        annotations: { destructiveHint: true, openWorldHint: false },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const run = await evaluations.cancel(actorUserId, runId);
          return {
            artifact: { id: run.id, kind: "evaluation", href: `/evaluations/${run.id}` },
            run,
            summary:
              run.status === "cancelled"
                ? `Cancelled evaluation run ${run.id}.`
                : `Evaluation run ${run.id} was already ${run.status}.`,
          };
        },
      }),
    ]);
  }
}
