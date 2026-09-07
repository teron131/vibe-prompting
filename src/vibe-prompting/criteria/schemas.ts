/** Owns reusable Criterion definitions, ordered Criteria references, and their persisted library contracts. */

import { z } from "zod";

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

export type Criterion = z.infer<typeof criterionSchema>;

const resourceNameSchema = z.string().trim().min(1).max(120);
export const savedCriterionSchema = criterionSchema.and(
  z.object({ id: z.uuid(), version: z.number().int().positive() }),
);

export const savedCriterionInputSchema = criterionSchema;
export const criteriaInputSchema = z.object({
  name: resourceNameSchema,
  criterionIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, "Criteria cannot repeat a Criterion."),
});

export type SavedCriterion = Criterion & {
  id: string;
  version: number;
};

export type SavedCriterionInput = z.infer<typeof savedCriterionInputSchema>;

export type Criteria = {
  id: string;
  name: string;
  criterionSequence: SavedCriterion[];
  version: number;
};

export type CriteriaInput = z.infer<typeof criteriaInputSchema>;

export type CriterionDeletion = {
  affectedCriteriaCount: number;
  criteria: Criteria[];
};
