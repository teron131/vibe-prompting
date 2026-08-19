/** Exposes the evaluator's transport-independent API so HTTP and agent callers can share it without importing the application layer or creating a dependency cycle. */

import { z } from "zod";

import { type Target, targetSchema } from "../target/api.ts";
import { evaluatorGraph, type EvaluatorScore } from "./engine/graph.ts";
import type {
  EvaluationCriteria as InternalCriteria,
  EvaluationCriterion as InternalCriterion,
} from "./engine/schemas.ts";

const instructionSchema = z.string().trim().min(1);
const categoriesSchema = z
  .array(z.string().trim().min(1))
  .min(2)
  .refine((categories) => new Set(categories).size === categories.length, {
    message: "Criterion categories must be unique.",
  });

const criterionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("boolean"),
    instruction: instructionSchema,
  }),
  z.object({
    type: z.literal("categorical"),
    categories: categoriesSchema,
    instruction: instructionSchema,
  }),
  z.object({
    type: z.literal("numeric"),
    min: z.number(),
    max: z.number(),
    instruction: instructionSchema,
  }),
  z.object({
    type: z.literal("text"),
    instruction: instructionSchema,
  }),
  z.object({
    type: z.literal("correction"),
    instruction: instructionSchema,
  }),
]);

const criteriaSchema = z
  .array(criterionSchema)
  .min(1)
  .superRefine((criteria, context) => {
    criteria.forEach((criterion, index) => {
      if (criterion.type === "numeric" && criterion.min >= criterion.max) {
        context.addIssue({
          code: "custom",
          message: "Criterion min must be below max.",
          path: [index, "min"],
        });
      }
    });

    if (criteria.filter(({ type }) => type === "correction").length > 1) {
      context.addIssue({
        code: "custom",
        message: "A case may contain at most one correction criterion.",
      });
    }
  });

const judgeModelSchema = z.string().trim().min(1);
const judgesSchema = z
  .union([judgeModelSchema, z.array(judgeModelSchema).min(1)])
  .superRefine((judges, context) => {
    if (Array.isArray(judges) && new Set(judges).size !== judges.length) {
      context.addIssue({ code: "custom", message: "Judge model IDs must be unique." });
    }
  });

export const requestSchema = z.object({
  judges: judgesSchema,
  cases: z
    .array(
      z.object({
        input: z.unknown().refine((input) => input !== undefined, "Case input is required."),
        criteria: criteriaSchema,
      }),
    )
    .min(1),
});

export type Criterion = z.infer<typeof criterionSchema>;

export type EvaluationCase<INPUT = unknown> = {
  input: INPUT;
  criteria: Criterion[];
};

export type EvaluationRequest<INPUT = unknown> = {
  judges: string | string[];
  cases: EvaluationCase<INPUT>[];
};

export type CriterionEvaluation = {
  criterion: Criterion;
  value: boolean | number | string;
  judge: string;
  comment: string;
  evidence: string[];
};

export type EvaluatedCase<INPUT = unknown, OUTPUT = unknown> = {
  input: INPUT;
  output: OUTPUT;
  evaluations: CriterionEvaluation[];
};

export type EvaluationRun<INPUT = unknown, OUTPUT = unknown> = {
  cases: EvaluatedCase<INPUT, OUTPUT>[];
};

/** Evaluates opaque input-output behavior and returns only public case results. */
export async function evaluate<INPUT, OUTPUT>(
  target: Target<INPUT, OUTPUT>,
  request: EvaluationRequest<INPUT>,
): Promise<EvaluationRun<INPUT, OUTPUT>> {
  const configuredTarget = targetSchema.parse(target) as Target<INPUT, OUTPUT>;
  const configuredRequest = requestSchema.parse(request) as EvaluationRequest<INPUT>;
  const configuredCases = configuredRequest.cases.map((testCase) => ({
    ...testCase,
    internalCriteria: testCase.criteria.map(toInternalCriterion),
  }));

  const { results } = await evaluatorGraph.invoke({
    target: {
      model: configuredTarget.model,
      invoke: (input: unknown) => configuredTarget.invoke(input as INPUT),
    },
    runName: configuredTarget.model,
    cases: configuredCases.map(({ input, internalCriteria }) => ({
      input,
      criteria: internalCriteria,
    })),
    judges: { model: configuredRequest.judges },
  });

  const cases = results.map((item, caseIndex) => {
    const configuredCase = configuredCases[caseIndex];
    if (!configuredCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
    return {
      input: configuredCase.input,
      output: item.output as OUTPUT,
      evaluations: item.evaluations.map((evaluation) =>
        projectEvaluation(evaluation, configuredCase.criteria, configuredCase.internalCriteria),
      ),
    };
  });

  return { cases };
}

function toInternalCriterion(criterion: Criterion, index: number): InternalCriterion {
  const name = criterion.type === "correction" ? "output" : `criterion_${index + 1}`;
  switch (criterion.type) {
    case "boolean":
      return { name, dataType: "BOOLEAN", instruction: criterion.instruction };
    case "categorical":
      return {
        name,
        dataType: "CATEGORICAL",
        categories: criterion.categories,
        instruction: criterion.instruction,
      };
    case "numeric":
      return {
        name,
        dataType: "NUMERIC",
        minValue: criterion.min,
        maxValue: criterion.max,
        instruction: criterion.instruction,
      };
    case "text":
      return { name, dataType: "TEXT", instruction: criterion.instruction };
    case "correction":
      return { name: "output", dataType: "CORRECTION", instruction: criterion.instruction };
  }
}

function projectEvaluation(
  evaluation: EvaluatorScore,
  criteria: Criterion[],
  internalCriteria: InternalCriteria,
): CriterionEvaluation {
  const criterionIndex = internalCriteria.findIndex(
    ({ name }) => name === evaluation.criterionName,
  );
  const criterion = criteria[criterionIndex];
  if (!criterion) throw new Error(`Unknown evaluated criterion: ${evaluation.criterionName}.`);
  return {
    criterion,
    value: projectValue(criterion, evaluation.value),
    judge: evaluation.judgeModel,
    comment: evaluation.comment,
    evidence: evaluation.evidence,
  };
}

function projectValue(
  criterion: Criterion,
  value: boolean | number | string,
): boolean | number | string {
  switch (criterion.type) {
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Boolean evaluation must be Boolean.");
      return value;
    case "categorical":
      if (typeof value !== "string" || !criterion.categories.includes(value)) {
        throw new Error("Categorical evaluation must use one of the configured categories.");
      }
      return value;
    case "numeric":
      if (typeof value !== "number" || value < criterion.min || value > criterion.max) {
        throw new Error("Numeric evaluation must be within the configured range.");
      }
      return value;
    case "text":
    case "correction":
      if (typeof value !== "string") throw new Error("Text evaluation must contain text.");
      return value;
  }
}
