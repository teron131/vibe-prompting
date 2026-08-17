/** Owns validation and static contracts for the transport-neutral evaluation API boundary. */

import { z } from "zod";

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

export const targetSchema = z.custom<Target>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "model" in value &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model === value.model.trim() &&
    "invoke" in value &&
    typeof value.invoke === "function",
  "Target must expose a non-empty model ID and an invoke function.",
);

export type Criterion = z.infer<typeof criterionSchema>;

export type EvaluationCase<INPUT = unknown> = {
  input: INPUT;
  criteria: Criterion[];
};

export type EvaluationRequest<INPUT = unknown> = {
  judges: string | string[];
  cases: EvaluationCase<INPUT>[];
};

export type Target<INPUT = unknown, OUTPUT = unknown> = {
  readonly model: string;
  invoke(input: INPUT): PromiseLike<OUTPUT>;
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
