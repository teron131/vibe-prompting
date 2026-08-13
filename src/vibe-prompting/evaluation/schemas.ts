/** Defines the persistence-independent score contract shared by judges and evaluator workflows. */

import { z } from "zod";

export type JudgeScoreType = "BOOLEAN" | "CATEGORICAL" | "CORRECTION" | "NUMERIC" | "TEXT";

export type JudgeOutput<VALUE> = {
  comment: string;
  evidence: string[];
  value: VALUE;
};

export type JudgeResult<VALUE, TYPE extends JudgeScoreType> = JudgeOutput<VALUE> & {
  dataType: TYPE;
  name: string;
};

const commentSchema = z
  .string()
  .min(1)
  .describe("Briefly explain how the criterion led to this result.");
const EVIDENCE_DESCRIPTION =
  "Concrete details from the evaluation record that support the result, or an empty array when none are available.";
const evidenceSchema = z.array(z.string().min(1)).describe(EVIDENCE_DESCRIPTION);

export const booleanOutputSchema = z.object({
  comment: commentSchema,
  evidence: evidenceSchema,
  value: z.boolean().describe("Whether the evaluated result satisfies the criterion."),
});

const criterionFields = {
  instructions: z.string().trim().min(1),
  name: z.string().trim().min(1),
};

const criterionSchema = z.discriminatedUnion("dataType", [
  z.object({ ...criterionFields, dataType: z.literal("BOOLEAN") }),
  z.object({
    ...criterionFields,
    categories: z.array(z.string().trim().min(1)).min(2),
    dataType: z.literal("CATEGORICAL"),
  }),
  z.object({
    ...criterionFields,
    dataType: z.literal("NUMERIC"),
    maxValue: z.number(),
    minValue: z.number(),
  }),
  z.object({ ...criterionFields, dataType: z.literal("TEXT") }),
  z.object({
    dataType: z.literal("CORRECTION"),
    instructions: criterionFields.instructions,
    name: z.literal("output"),
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

const resultFields = {
  comment: commentSchema,
  evidence: evidenceSchema,
  name: z.string().trim().min(1).describe("The evaluated criterion name, copied exactly."),
};

const evaluationResultSchema = z.discriminatedUnion("dataType", [
  z.object({
    ...resultFields,
    dataType: z.literal("BOOLEAN"),
    value: z.boolean().describe("Whether the evaluated result satisfies the criterion."),
  }),
  z.object({
    ...resultFields,
    dataType: z.literal("CATEGORICAL"),
    value: z
      .string()
      .min(1)
      .describe("The configured category that best matches the evaluated result."),
  }),
  z.object({
    ...resultFields,
    dataType: z.literal("CORRECTION"),
    name: z.literal("output"),
    value: z.string().min(1).describe("The complete replacement Target output."),
  }),
  z.object({
    ...resultFields,
    dataType: z.literal("NUMERIC"),
    value: z.number().describe("The score assigned under the criterion's scale."),
  }),
  z.object({
    ...resultFields,
    dataType: z.literal("TEXT"),
    value: z
      .string()
      .min(1)
      .max(500)
      .describe("The standalone qualitative assessment requested by the criterion."),
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

export function createCategoricalOutputSchema<
  const CATEGORIES extends readonly [string, ...string[]],
>(categories: CATEGORIES) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z.enum(categories).describe("The category that best matches the evaluated result."),
  });
}

export function createNumericOutputSchema(minValue: number, maxValue: number) {
  return z.object({
    comment: commentSchema,
    evidence: evidenceSchema,
    value: z
      .number()
      .min(minValue)
      .max(maxValue)
      .describe("The score assigned under the criterion's scale."),
  });
}
