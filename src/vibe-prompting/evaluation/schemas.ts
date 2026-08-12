/** Defines structured LLM-judge outputs and reusable score-result types. */

import { z } from "zod";

export type JudgeScoreType = "BOOLEAN" | "CATEGORICAL" | "NUMERIC";

export type JudgeOutput<VALUE> = {
  comment: string;
  evidence: string[];
  value: VALUE;
};

export type JudgeResult<VALUE, TYPE extends JudgeScoreType> = JudgeOutput<VALUE> & {
  dataType: TYPE;
  name: string;
};

const commentSchema = z.string().min(1).describe("Concise reasoning for the score.");
const EVIDENCE_DESCRIPTION =
  "Specific evidence supporting the score, or an empty array when no evidence is available.";
const evidenceSchema = z.array(z.string().min(1)).describe(EVIDENCE_DESCRIPTION);

export const booleanOutputSchema = z.object({
  comment: commentSchema,
  evidence: evidenceSchema,
  value: z.boolean().describe("The binary evaluation result."),
});

/** Creates a structured-output schema restricted to the configured categories. */
export function createCategoricalOutputSchema<
  const CATEGORIES extends readonly [string, ...string[]],
>(categories: CATEGORIES) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z.enum(categories).describe("The selected evaluation category."),
  });
}

/** Creates a structured-output schema restricted to the configured numeric range. */
export function createNumericOutputSchema(minValue: number, maxValue: number) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z.number().min(minValue).max(maxValue).describe("The numeric evaluation score."),
  });
}
