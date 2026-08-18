/** Gives one agent a focused evaluation tool bound to its current temporary prompt file. */

import { createHash } from "node:crypto";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import { createChatModel } from "../../clients/llm.ts";
import { loadRuntimeConfig } from "../../config.ts";
import { evaluate } from "../../evaluation/api.ts";
import type { PromptWorkspace } from "../artifacts.ts";

const evaluationCaseSchema = z.object({
  input: z.string().trim().min(1).describe("One realistic user message to run against prompt.md."),
  criteria: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(4)
    .describe("Focused Boolean requirements for judging the resulting response."),
});

export type PromptEvaluationSnapshot = {
  markdownHash: string;
  report: {
    cases: Array<{
      evaluations: Array<{
        comment: string;
        criterion: string;
        evidence: string[];
        passed: boolean;
      }>;
      input: string;
      output: unknown;
    }>;
    judgeModel: string;
    targetModel: string;
  };
};

export function createPromptEvaluationTool(
  workspace: PromptWorkspace,
  onEvaluation?: (snapshot: PromptEvaluationSnapshot) => void,
): Tool {
  const modelIds = loadRuntimeConfig().models.map(({ id }) => id);
  const modelIdSchema = z.enum(modelIds as [string, ...string[]]);
  const availableModels = modelIds.join(", ");

  return tool({
    name: "evaluate_prompt",
    description:
      "Run focused behavioral cases against the current prompt.md and judge each criterion. Use only when the user explicitly asks to test, evaluate, validate, or optimize the prompt, or supplies test cases or acceptance criteria; do not call this for routine edits.",
    parameters: z.object({
      cases: z.array(evaluationCaseSchema).min(1).max(3),
      judgeModel: modelIdSchema.describe(`Configured judge model. Available: ${availableModels}.`),
      targetModel: modelIdSchema.describe(
        `Configured model that runs prompt.md. Available: ${availableModels}.`,
      ),
    }),
    async execute({ cases, judgeModel, targetModel }) {
      const markdown = await workspace.read();
      const model = createChatModel({ model: targetModel });
      const run = await evaluate(
        {
          model: targetModel,
          async invoke(caseInput: string) {
            return (await model.invoke([new SystemMessage(markdown), new HumanMessage(caseInput)]))
              .text;
          },
        },
        {
          judges: judgeModel,
          cases: cases.map((testCase) => ({
            input: testCase.input,
            criteria: testCase.criteria.map((instruction) => ({
              type: "boolean" as const,
              instruction,
            })),
          })),
        },
      );

      const report = {
        targetModel,
        judgeModel,
        cases: run.cases.map((evaluatedCase) => ({
          input: evaluatedCase.input,
          output: evaluatedCase.output,
          evaluations: evaluatedCase.evaluations.map((evaluation) => {
            if (typeof evaluation.value !== "boolean") {
              throw new Error("Prompt evaluation criteria must return Boolean values.");
            }
            return {
              criterion: evaluation.criterion.instruction,
              passed: evaluation.value,
              comment: evaluation.comment,
              evidence: evaluation.evidence,
            };
          }),
        })),
      };
      onEvaluation?.({
        markdownHash: createHash("sha256").update(markdown).digest("hex"),
        report,
      });
      return report;
    },
  });
}
