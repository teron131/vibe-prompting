/** Owns the toolkit for starting, inspecting, and stopping durable static or generative Scenario Runs. */

import { z } from "zod";

import { criteriaSchema } from "../../evaluation/api.ts";
import { MAX_SCENARIO_TURNS, type ScenarioRuns } from "../../target/scenarios/index.ts";
import { AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";
import { type ConfiguredModelReference, resolveConfiguredModelId } from "./evaluation.ts";

const modelReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Configured model ID or display label.");

const evaluationPlanSchema = z.object({
  configurations: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        criteria: criteriaSchema,
      }),
    )
    .min(1),
  judgeModels: z.array(modelReferenceSchema).min(1),
});

const startBaseSchema = z.object({
  promptId: z.uuid().describe("Saved prompt ID."),
  promptRevisionId: z.uuid().describe("Exact prompt revision ID to run."),
  targetModel: modelReferenceSchema.describe("Configured Target model ID or display label."),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  evaluationPlan: evaluationPlanSchema.optional(),
});

const startSchema = startBaseSchema
  .extend({
    mode: z.enum(["static", "generative"]),
    driverModel: modelReferenceSchema
      .optional()
      .describe("Optional Driver model override; defaults to the Target model."),
    instruction: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Rough instruction sent to the Driver to role-play user messages."),
    messages: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(MAX_SCENARIO_TURNS)
      .optional()
      .describe("Predetermined ordered user messages."),
    maxTurns: z.number().int().min(1).max(MAX_SCENARIO_TURNS).default(5),
  })
  .superRefine((input, context) => {
    if (input.mode === "generative" && !input.instruction) {
      context.addIssue({ code: "custom", message: "Generative mode requires an instruction." });
    }
    if (input.mode === "static" && !input.messages) {
      context.addIssue({ code: "custom", message: "Static mode requires messages." });
    }
  });

const runSchema = z.object({ runId: z.uuid().describe("Scenario Run ID.") });

export class ScenarioRunsToolkit extends AgentToolkit {
  constructor(
    scenarios: ScenarioRuns,
    loadModels: () => Promise<readonly ConfiguredModelReference[]>,
  ) {
    super("scenario-runs", [
      defineAgentTool({
        name: "start_scenario_run",
        title: "Start Scenario Run",
        description:
          "Start a durable static or adaptive generative Scenario against one exact prompt revision and configured Target model.",
        parameters: startSchema,
        annotations: { destructiveHint: false, openWorldHint: true },
        async execute(input, context) {
          const { actorUserId, chatId } = requireAgentActor(context);
          const models = await loadModels();
          const targetModel = resolveConfiguredModelId(input.targetModel, models);
          const driverModel =
            input.mode === "generative" && input.driverModel
              ? resolveConfiguredModelId(input.driverModel, models)
              : undefined;
          const evaluationPlan = input.evaluationPlan
            ? {
                ...input.evaluationPlan,
                judgeModels: input.evaluationPlan.judgeModels.map((model) =>
                  resolveConfiguredModelId(model, models),
                ),
              }
            : undefined;
          const request =
            input.mode === "static"
              ? {
                  promptId: input.promptId,
                  promptRevisionId: input.promptRevisionId,
                  targetModel,
                  reasoningEffort: input.reasoningEffort,
                  evaluationPlan,
                  mode: "static" as const,
                  messages: requireStaticMessages(input.messages),
                }
              : {
                  promptId: input.promptId,
                  promptRevisionId: input.promptRevisionId,
                  targetModel,
                  reasoningEffort: input.reasoningEffort,
                  evaluationPlan,
                  mode: "generative" as const,
                  instruction: requireGenerativeInstruction(input.instruction),
                  driverModel,
                  maxTurns: input.maxTurns,
                };
          const response = await scenarios.startAgentRun(actorUserId, request, chatId);
          return {
            artifact: {
              id: response.scenario.id,
              kind: "scenario-run",
              href: `/evaluations/scenarios/${response.scenario.id}`,
            },
            ...response,
            summary: `Started Scenario Run ${response.scenario.id}.`,
          };
        },
      }),
      defineAgentTool({
        name: "read_scenario_run",
        title: "Read Scenario Run",
        description:
          "Read one Scenario Run with its normalized Driver Brief, lifecycle, model provenance, limits, stop reason, and linked Target trace.",
        parameters: runSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const response = await scenarios.getRunResponse(actorUserId, runId);
          return {
            artifact: {
              id: runId,
              kind: "scenario-run",
              href: `/evaluations/scenarios/${runId}`,
            },
            ...response,
            summary: `Read Scenario Run ${runId}.`,
          };
        },
      }),
      defineAgentTool({
        name: "stop_scenario_run",
        title: "Stop Scenario Run",
        description:
          "Stop a queued or running Scenario and its active Target turn while preserving completed trace evidence.",
        parameters: runSchema,
        annotations: { openWorldHint: false, destructiveHint: true },
        async execute({ runId }, context) {
          const { actorUserId } = requireAgentActor(context);
          const response = await scenarios.cancel(actorUserId, runId);
          return {
            artifact: {
              id: runId,
              kind: "scenario-run",
              href: `/evaluations/scenarios/${runId}`,
            },
            ...response,
            summary: `Stopped Scenario Run ${runId}.`,
          };
        },
      }),
    ]);
  }
}

function requireStaticMessages(messages: string[] | undefined): string[] {
  if (!messages) throw new Error("Static mode requires messages.");
  return messages;
}

function requireGenerativeInstruction(instruction: string | undefined): string {
  if (!instruction) throw new Error("Generative mode requires an instruction.");
  return instruction;
}
