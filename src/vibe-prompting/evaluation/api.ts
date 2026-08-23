/** Exposes the evaluator's transport-independent API so HTTP and agent callers can share it without importing the application layer or creating a dependency cycle. */

import { z } from "zod";

import { type Target, targetSchema } from "../target/api.ts";
import { evaluatorGraph, type EvaluatorScore } from "./engine/graph.ts";
import type {
  EvaluationCriteria as InternalCriteria,
  EvaluationCriterion as InternalCriterion,
} from "./engine/schemas.ts";

const instructionSchema = z.string().trim().min(1);
const criterionNameSchema = z.string().trim().min(1).max(120);
const categoriesSchema = z
  .array(z.string().trim().min(1))
  .min(2)
  .refine((categories) => new Set(categories).size === categories.length, {
    message: "Criterion categories must be unique.",
  });

export const criterionSchema = z.discriminatedUnion("type", [
  z.object({
    name: criterionNameSchema,
    type: z.literal("boolean"),
    instruction: instructionSchema,
  }),
  z.object({
    name: criterionNameSchema,
    type: z.literal("categorical"),
    instruction: instructionSchema,
    categories: categoriesSchema,
  }),
  z.object({
    name: criterionNameSchema,
    type: z.literal("numeric"),
    instruction: instructionSchema,
    min: z.number(),
    max: z.number(),
  }),
  z.object({
    name: criterionNameSchema,
    type: z.literal("text"),
    instruction: instructionSchema,
  }),
  z.object({
    name: criterionNameSchema,
    type: z.literal("correction"),
    instruction: instructionSchema,
  }),
]);

export const criteriaSchema = z
  .array(criterionSchema)
  .min(1)
  .max(10)
  .superRefine((criteria, context) => {
    if (new Set(criteria.map(({ name }) => name.toLocaleLowerCase())).size !== criteria.length) {
      context.addIssue({
        code: "custom",
        message: "Criterion names must be unique within a case.",
      });
    }

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
  cases: z
    .array(
      z.object({
        input: z.unknown().refine((input) => input !== undefined, "Case input is required."),
        criteria: criteriaSchema,
      }),
    )
    .min(1),
  judges: judgesSchema,
});

export const recordedRequestSchema = z.object({
  cases: z
    .array(
      z.object({
        input: z.unknown().refine((input) => input !== undefined, "Case input is required."),
        output: z
          .unknown()
          .refine((output) => output !== undefined, "Recorded output is required."),
        criteria: criteriaSchema,
      }),
    )
    .min(1),
  judges: judgesSchema,
});

export type Criterion = z.infer<typeof criterionSchema>;

export type EvaluationCase<INPUT = unknown> = {
  input: INPUT;
  criteria: Criterion[];
};

export type EvaluationRequest<INPUT = unknown> = {
  cases: EvaluationCase<INPUT>[];
  judges: string | string[];
};

export type RecordedEvaluationCase<INPUT = unknown, OUTPUT = unknown> = EvaluationCase<INPUT> & {
  output: OUTPUT;
};

export type RecordedEvaluationRequest<INPUT = unknown, OUTPUT = unknown> = {
  cases: RecordedEvaluationCase<INPUT, OUTPUT>[];
  judges: string | string[];
};

export type CriterionEvaluation = {
  criterion: Criterion;
  judge: string;
  value: boolean | number | string;
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
  const validatedTarget = targetSchema.parse(target) as Target<INPUT, OUTPUT>;
  const validatedRequest = requestSchema.parse(request) as EvaluationRequest<INPUT>;
  return runEvaluation({
    cases: validatedRequest.cases,
    judges: validatedRequest.judges,
    target: {
      model: validatedTarget.model,
      invoke: (input: unknown) => validatedTarget.invoke(input as INPUT),
    },
    targetModel: validatedTarget.model,
  });
}

/** Scores already completed input-output behavior without invoking a Target again. */
export async function evaluateRecorded<INPUT, OUTPUT>(
  targetModel: string,
  request: RecordedEvaluationRequest<INPUT, OUTPUT>,
): Promise<EvaluationRun<INPUT, OUTPUT>> {
  const model = z.string().trim().min(1).parse(targetModel);
  const validatedRequest = recordedRequestSchema.parse(request) as RecordedEvaluationRequest<
    INPUT,
    OUTPUT
  >;
  return runEvaluation({
    cases: validatedRequest.cases,
    judges: validatedRequest.judges,
    targetModel: model,
  });
}

async function runEvaluation<INPUT, OUTPUT>(input: {
  cases: Array<EvaluationCase<INPUT> & { output?: OUTPUT }>;
  judges: string | string[];
  target?: Target<unknown, unknown>;
  targetModel: string;
}): Promise<EvaluationRun<INPUT, OUTPUT>> {
  const validatedCases = input.cases.map((testCase) => ({
    ...testCase,
    internalCriteria: testCase.criteria.map(toInternalCriterion),
  }));

  const { results } = await evaluatorGraph.invoke({
    target: input.target,
    targetModel: input.targetModel,
    runName: input.targetModel,
    cases: validatedCases.map(({ input: caseInput, internalCriteria, output }) => ({
      input: caseInput,
      output,
      criteria: internalCriteria,
    })),
    judges: { model: input.judges },
  });

  const cases = results.map((item, caseIndex) => {
    const validatedCase = validatedCases[caseIndex];
    if (!validatedCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
    return {
      input: validatedCase.input,
      output: item.output as OUTPUT,
      evaluations: item.evaluations.map((evaluation) =>
        projectEvaluation(evaluation, validatedCase.criteria, validatedCase.internalCriteria),
      ),
    };
  });

  return { cases };
}

/** Projects the public Criterion into the engine contract while preserving its human name. */
function toInternalCriterion(criterion: Criterion): InternalCriterion {
  const { name } = criterion;
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
      return { name, dataType: "CORRECTION", instruction: criterion.instruction };
  }
}

/** Converts one engine score back to the public criterion and validates its typed value. */
function projectEvaluation(
  evaluation: EvaluatorScore,
  publicCriteria: Criterion[],
  engineCriteria: InternalCriteria,
): CriterionEvaluation {
  const criterionIndex = engineCriteria.findIndex(({ name }) => name === evaluation.criterionName);
  const criterion = publicCriteria[criterionIndex];
  if (!criterion) throw new Error(`Unknown evaluated criterion: ${evaluation.criterionName}.`);
  return {
    criterion,
    value: projectValue(criterion, evaluation.value),
    judge: evaluation.judgeModel,
    comment: evaluation.comment,
    evidence: evaluation.evidence,
  };
}

/** Enforces the public criterion type and range before exposing a judge value. */
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
