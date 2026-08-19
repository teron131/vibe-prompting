/** Defines the evaluation engine's normalized subjects, criteria, reports, and attributed scores. */

import { z } from "zod";

export const evaluationSubjectSchema = z.object({
  input: z.unknown(),
  output: z.unknown(),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EvaluationSubject = z.infer<typeof evaluationSubjectSchema>;
export type JudgeScoreType = "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";

export type EvaluatorScore = {
  criterionName: string;
  dataType: JudgeScoreType;
  value: boolean | number | string;
  judgeModel: string;
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
    name: z.literal("output"),
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
    name: z.literal("output"),
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

export const evaluationReportSchema = z.object({
  results: z.array(evaluationResultSchema).min(1),
});

export type EvaluationCriterion = z.infer<typeof criterionSchema>;
export type EvaluationCriteria = z.infer<typeof evaluationCriteriaSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export function createEvaluationReportSchema(criteria: EvaluationCriteria) {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const criteriaByName = new Map(
    configuredCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return evaluationReportSchema.superRefine(({ results }, context) => {
    if (results.length !== configuredCriteria.length) {
      context.addIssue({
        code: "custom",
        message: "The report must contain exactly one result per criterion.",
        path: ["results"],
      });
    }

    if (new Set(results.map(({ name }) => name)).size !== results.length) {
      context.addIssue({
        code: "custom",
        message: "Result names must be unique.",
        path: ["results"],
      });
    }

    results.forEach((result, index) => {
      const criterion = criteriaByName.get(result.name);
      if (!criterion) {
        context.addIssue({
          code: "custom",
          message: `Unknown criterion: ${result.name}.`,
          path: ["results", index, "name"],
        });
        return;
      }
      if (result.dataType !== criterion.dataType) {
        context.addIssue({
          code: "custom",
          message: `Result dataType must be ${criterion.dataType}.`,
          path: ["results", index, "dataType"],
        });
        return;
      }
      if (
        result.dataType === "CATEGORICAL" &&
        criterion.dataType === "CATEGORICAL" &&
        !criterion.categories.includes(result.value)
      ) {
        context.addIssue({
          code: "custom",
          message: "Result value must be one of the configured categories.",
          path: ["results", index, "value"],
        });
      }
      if (
        result.dataType === "NUMERIC" &&
        criterion.dataType === "NUMERIC" &&
        (result.value < criterion.minValue || result.value > criterion.maxValue)
      ) {
        context.addIssue({
          code: "custom",
          message: "Result value must be within the configured range.",
          path: ["results", index, "value"],
        });
      }
    });
  });
}
