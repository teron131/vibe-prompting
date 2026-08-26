/** Defines the evaluation engine's normalized subjects, criteria, reports, and attributed scores. */

import { z } from "zod";

export const evaluationSubjectSchema = z.object({
  input: z.unknown(),
  output: z.unknown(),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EvaluationSubject = z.infer<typeof evaluationSubjectSchema>;
type JudgeScoreType = "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";

export type EvaluatorScore = {
  criterionName: string;
  dataType: JudgeScoreType;
  judgeModel: string;
  value: boolean | number | string;
  comment: string;
  evidence: string[];
};

const commentSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Briefly explain how the criterion led to this result.");
const EVIDENCE_DESCRIPTION =
  "Concrete details from the evaluation record that support the result, or an empty array when none are available.";
const evidenceSchema = z.array(z.string().trim().min(1)).describe(EVIDENCE_DESCRIPTION);
const resultDetails = {
  comment: commentSchema,
  evidence: evidenceSchema,
};

const criterionNameSchema = z.string().trim().min(1);
const criterionInstructionSchema = z.string().trim().min(1);

const criterionSchema = z.discriminatedUnion("dataType", [
  z.object({
    name: criterionNameSchema,
    dataType: z.literal("BOOLEAN"),
    instruction: criterionInstructionSchema,
  }),
  z.object({
    name: criterionNameSchema,
    dataType: z.literal("CATEGORICAL"),
    instruction: criterionInstructionSchema,
    categories: z.array(z.string().trim().min(1)).min(2),
  }),
  z.object({
    name: criterionNameSchema,
    dataType: z.literal("NUMERIC"),
    instruction: criterionInstructionSchema,
    minValue: z.number(),
    maxValue: z.number(),
  }),
  z.object({
    name: criterionNameSchema,
    dataType: z.literal("TEXT"),
    instruction: criterionInstructionSchema,
  }),
  z.object({
    name: criterionNameSchema,
    dataType: z.literal("CORRECTION"),
    instruction: criterionInstructionSchema,
  }),
]);

export const evaluationCriteriaSchema = z
  .array(criterionSchema)
  .min(1)
  .superRefine((criteria, context) => {
    if (new Set(criteria.map(({ name }) => name)).size !== criteria.length) {
      context.addIssue({
        code: "custom",
        message: "Criterion names must be unique.",
      });
    }

    criteria.forEach((criterion, index) => {
      if (
        criterion.dataType === "CATEGORICAL" &&
        new Set(criterion.categories).size !== criterion.categories.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Criterion categories must be unique.",
          path: [index, "categories"],
        });
      }
      if (criterion.dataType === "NUMERIC" && criterion.minValue >= criterion.maxValue) {
        context.addIssue({
          code: "custom",
          message: "Criterion minValue must be below maxValue.",
          path: [index, "minValue"],
        });
      }
    });
  });

const resultNameSchema = z
  .string()
  .trim()
  .min(1)
  .describe("The evaluated criterion name, copied exactly.");

const evaluationResultSchema = z.discriminatedUnion("dataType", [
  z.object({
    name: resultNameSchema,
    dataType: z.literal("BOOLEAN"),
    value: z.boolean().describe("Whether the evaluated result satisfies the criterion."),
    ...resultDetails,
  }),
  z.object({
    name: resultNameSchema,
    dataType: z.literal("CATEGORICAL"),
    value: z
      .string()
      .trim()
      .min(1)
      .describe("The configured category that best matches the evaluated result."),
    ...resultDetails,
  }),
  z.object({
    name: resultNameSchema,
    dataType: z.literal("CORRECTION"),
    value: z.string().trim().min(1).describe("The complete replacement Target output."),
    ...resultDetails,
  }),
  z.object({
    name: resultNameSchema,
    dataType: z.literal("NUMERIC"),
    value: z.number().describe("The score assigned under the criterion's scale."),
    ...resultDetails,
  }),
  z.object({
    name: resultNameSchema,
    dataType: z.literal("TEXT"),
    value: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("The standalone qualitative assessment requested by the criterion."),
    ...resultDetails,
  }),
]);

export const evaluationResultsSchema = z.array(evaluationResultSchema).min(1);

export type EvaluationCriterion = z.infer<typeof criterionSchema>;
export type EvaluationCriteria = z.infer<typeof evaluationCriteriaSchema>;
export type EvaluationResults = z.infer<typeof evaluationResultsSchema>;

export type EvaluationResponse = Record<
  string,
  {
    value: boolean | number | string;
    comment: string;
    evidence: string[];
  }
>;

/** Builds a strict object-shaped response contract because provider structured outputs reject unions inside arrays. */
export function createEvaluationResponseSchema(
  criteria: EvaluationCriteria,
): z.ZodType<EvaluationResponse> {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const resultShape = Object.fromEntries(
    configuredCriteria.map((criterion) => [
      criterion.name,
      z
        .object({
          value: criterionValueSchema(criterion),
          comment: commentSchema,
          evidence: evidenceSchema,
        })
        .describe(`${criterion.name}: ${criterion.instruction}`),
    ]),
  );
  return z.object(resultShape) as z.ZodType<EvaluationResponse>;
}

export function projectEvaluationResponse(
  response: EvaluationResponse,
  criteria: EvaluationCriteria,
): EvaluationResults {
  return evaluationResultsSchema.parse(
    criteria.map((criterion) => ({
      ...response[criterion.name],
      dataType: criterion.dataType,
      name: criterion.name,
    })),
  );
}

function criterionValueSchema(criterion: EvaluationCriterion): z.ZodType {
  switch (criterion.dataType) {
    case "BOOLEAN":
      return z.boolean();
    case "CATEGORICAL":
      return z.enum(criterion.categories as [string, ...string[]]);
    case "CORRECTION":
      return z.string().trim().min(1);
    case "NUMERIC":
      return z.number().min(criterion.minValue).max(criterion.maxValue);
    case "TEXT":
      return z.string().trim().min(1).max(500);
  }
}
