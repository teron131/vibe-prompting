/** Exposes durable Target Run creation, continuation, and trace inspection through framework-neutral agent tools. */

import { z } from "zod";

import type { TargetRuns } from "../../target/runs/index.ts";
import { type AgentTool, defineAgentTool } from "./api.ts";
import { type ConfiguredModelReference, resolveConfiguredModelId } from "./evaluation.ts";

const startSchema = z.object({
  instruction: z.string().trim().min(1),
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  targetModelId: z.string().trim().min(1).describe("Configured target model ID or display label."),
});

const continueSchema = z.object({
  instruction: z.string().trim().min(1),
  runId: z.uuid(),
});

const readSchema = z.object({ runId: z.uuid() });

export function createTargetRunTools(
  targetRuns: TargetRuns,
  actorUserId: string,
  chatId: string,
  loadModels: () => Promise<readonly ConfiguredModelReference[]>,
): AgentTool[] {
  return [
    defineAgentTool({
      name: "start_target_run",
      description:
        "Start a durable multi-turn AI SDK Target Run pinned to one prompt revision, then return its trace link and status.",
      parameters: startSchema,
      async execute(input) {
        const run = await targetRuns.startAgentRun(
          actorUserId,
          {
            ...input,
            targetModelId: resolveConfiguredModelId(input.targetModelId, await loadModels()),
          },
          chatId,
        );
        return {
          artifact: { href: `/target-runs/${run.id}`, id: run.id, kind: "target-run" },
          run,
          summary: `Started Target Run ${run.id}.`,
        };
      },
    }),
    defineAgentTool({
      name: "continue_target_run",
      description:
        "Add one user turn to an existing durable Target Run while preserving its pinned prompt revision and AI SDK runtime configuration.",
      parameters: continueSchema,
      async execute({ instruction, runId }) {
        const run = await targetRuns.continueRun(actorUserId, runId, { instruction });
        return {
          artifact: { href: `/target-runs/${run.id}`, id: run.id, kind: "target-run" },
          run,
          summary: `Continued Target Run ${run.id}.`,
        };
      },
    }),
    defineAgentTool({
      name: "read_target_run",
      description:
        "Read one durable Target Run, including its exact prompt revision, runtime provenance, reasoning and tool activity, turn statuses, inputs, and completed outputs.",
      parameters: readSchema,
      async execute({ runId }) {
        const run = await targetRuns.getRun(actorUserId, runId);
        return {
          artifact: { href: `/target-runs/${run.id}`, id: run.id, kind: "target-run" },
          run,
          summary: `Read ${run.turnCount} turns from Target Run ${run.id}.`,
        };
      },
    }),
  ];
}
