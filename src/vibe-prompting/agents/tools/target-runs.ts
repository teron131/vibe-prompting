/** Owns the toolkit for durable Target Run creation, continuation, inspection, and stopping. */

import { z } from "zod";

import type { TargetRuns } from "../../target/runs/index.ts";
import { AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";
import { type ConfiguredModelReference, resolveConfiguredModelId } from "./evaluation.ts";

const startSchema = z.object({
  promptId: z.uuid().describe("Saved prompt ID."),
  promptRevisionId: z.uuid().describe("Exact prompt revision ID to run."),
  targetModel: z.string().trim().min(1).describe("Configured target model ID or display label."),
  instruction: z.string().trim().min(1).describe("Initial user turn sent to the Target."),
});

const continueSchema = z.object({
  runId: z.uuid().describe("Target Run ID."),
  instruction: z.string().trim().min(1).describe("Next user turn sent to the Target."),
});

const readSchema = z.object({ runId: z.uuid().describe("Target Run ID.") });

export class TargetRunsToolkit extends AgentToolkit {
  constructor(
    targetRuns: TargetRuns,
    loadModels: () => Promise<readonly ConfiguredModelReference[]>,
  ) {
    super("target-runs", [
      defineAgentTool({
        name: "start_target_run",
        title: "Start Target Run",
        description:
          "Start a durable multi-turn Target Run pinned to one exact prompt revision and configured target model, separate from general chat history.",
        parameters: startSchema,
        annotations: { destructiveHint: false, openWorldHint: true },
        async execute(input, context) {
          const { actorUserId, chatId } = requireAgentActor(context);
          const run = await targetRuns.startAgentRun(
            actorUserId,
            {
              ...input,
              targetModel: resolveConfiguredModelId(input.targetModel, await loadModels()),
            },
            chatId,
          );
          return {
            artifact: { id: run.id, kind: "target-run", href: `/target-runs/${run.id}` },
            run,
            summary: `Started Target Run ${run.id}.`,
          };
        },
      }),
      defineAgentTool({
        name: "continue_target_run",
        title: "Continue Target Run",
        description:
          "Add one user turn to an existing durable Target Run while preserving its pinned prompt revision, target model, configuration, and turn history.",
        parameters: continueSchema,
        annotations: { destructiveHint: false, openWorldHint: true },
        async execute({ runId, instruction }, context) {
          const { actorUserId } = requireAgentActor(context);
          const run = await targetRuns.continueRun(actorUserId, runId, { instruction });
          return {
            artifact: { id: run.id, kind: "target-run", href: `/target-runs/${run.id}` },
            run,
            summary: `Continued Target Run ${run.id}.`,
          };
        },
      }),
      defineAgentTool({
        name: "read_target_run",
        title: "Read Target Run",
        description:
          "Read one durable Target Run trace with its exact prompt revision, runtime provenance, reasoning and tool activity, turn statuses, inputs, and completed outputs.",
        parameters: readSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const run = await targetRuns.getRun(actorUserId, runId);
          return {
            artifact: { id: run.id, kind: "target-run", href: `/target-runs/${run.id}` },
            run,
            summary: `Read ${run.turnCount} turns from Target Run ${run.id}.`,
          };
        },
      }),
      defineAgentTool({
        name: "stop_target_run",
        title: "Stop Target Run",
        description:
          "Stop the active turn in one durable Target Run while preserving completed turns and persisted trace evidence.",
        parameters: readSchema,
        annotations: { destructiveHint: true, openWorldHint: false },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const stopped = await targetRuns.stop(actorUserId, runId);
          return {
            artifact: { id: runId, kind: "target-run", href: `/target-runs/${runId}` },
            stopped,
            summary: stopped
              ? `Stopped Target Run ${runId}.`
              : `Target Run ${runId} had no active turn.`,
          };
        },
      }),
    ]);
  }
}
