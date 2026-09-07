/** Validates judge subjects and responses against canonical Criteria definitions while retaining attributed score output shapes. */

import { z } from "zod";

import { criteriaSchema, type Criterion } from "../../criteria/schemas.ts";

export const evaluationSubjectSchema = z.object({
  input: z.unknown(),
  output: z.unknown(),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EvaluationSubject = z.infer<typeof evaluationSubjectSchema>;
type JudgeScoreType = Uppercase<Criterion["type"]>;

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
  criteria: Criterion[],
): z.ZodType<EvaluationResponse> {
  const configuredCriteria = criteriaSchema.parse(criteria);
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
  criteria: Criterion[],
): EvaluationResults {
  return evaluationResultsSchema.parse(
    criteria.map((criterion) => ({
      ...response[criterion.name],
      dataType: scoreDataType(criterion.type),
      name: criterion.name,
    })),
  );
}

function criterionValueSchema(criterion: Criterion): z.ZodType {
  switch (criterion.type) {
    case "boolean":
      return z.boolean();
    case "categorical":
      return z.enum(criterion.categories as [string, ...string[]]);
    case "correction":
      return z.string().trim().min(1);
    case "numeric":
      return z.number().min(criterion.min).max(criterion.max);
    case "text":
      return z.string().trim().min(1).max(500);
  }
}

/** Projects the canonical Criterion type into the existing graph and Langfuse score vocabulary. */
export function scoreDataType(type: Criterion["type"]): JudgeScoreType {
  return type.toUpperCase() as JudgeScoreType;
}
