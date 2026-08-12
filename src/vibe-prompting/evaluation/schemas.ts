/** Defines the persistence-independent score contract shared by judges and evaluator workflows. */

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

export function createCategoricalOutputSchema<
  const CATEGORIES extends readonly [string, ...string[]],
>(categories: CATEGORIES) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z.enum(categories).describe("The selected evaluation category."),
  });
}

export function createNumericOutputSchema(minValue: number, maxValue: number) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z.number().min(minValue).max(maxValue).describe("The numeric evaluation score."),
  });
}
