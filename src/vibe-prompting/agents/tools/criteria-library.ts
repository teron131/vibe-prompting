/** Owns the toolkit for shared Criterion resources and ordered Criteria permutations. */

import { z } from "zod";

import {
  criteriaInputSchema,
  type CriterionLibrary,
  savedCriterionInputSchema,
} from "../../evaluation/criteria.ts";
import { AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";

const criterionCreateSchema = z.object({
  criterion: savedCriterionInputSchema.describe("Reusable named typed Criterion definition."),
});
const criterionUpdateSchema = z.object({
  criterionId: z.uuid().describe("Criterion ID."),
  expectedVersion: z.number().int().positive().describe("Current Criterion version."),
  criterion: savedCriterionInputSchema.describe("Complete replacement Criterion definition."),
});
const criteriaUpdateSchema = criteriaInputSchema.extend({
  criteriaId: z.uuid().describe("Criteria ID."),
  expectedVersion: z.number().int().positive().describe("Current Criteria version."),
});

/** Keeps agent mutations on the same optimistic-concurrency contracts as the website. */
export class CriteriaLibraryToolkit extends AgentToolkit {
  constructor(library: CriterionLibrary) {
    super("criteria-library", [
      defineAgentTool({
        name: "list_criteria_library",
        title: "List Criterion and Criteria",
        description:
          "List all reusable Criterion definitions and named ordered Criteria permutations with their stable IDs and current versions.",
        parameters: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute() {
          const [criterion, criteria] = await Promise.all([
            library.listCriterion(),
            library.listCriteria(),
          ]);
          return { criterion, criteria };
        },
      }),
      defineAgentTool({
        name: "create_criterion",
        title: "Create Criterion",
        description: "Create one reusable named typed Criterion in the shared library.",
        parameters: criterionCreateSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute({ criterion }, context) {
          const { actorUserId } = requireAgentActor(context);
          return {
            criterion: await library.createCriterion(actorUserId, criterion),
            summary: "Created Criterion.",
          };
        },
      }),
      defineAgentTool({
        name: "update_criterion",
        title: "Update Criterion",
        description:
          "Replace one shared Criterion using its expected version for optimistic concurrency.",
        parameters: criterionUpdateSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute({ criterionId, expectedVersion, criterion }, context) {
          const { actorUserId } = requireAgentActor(context);
          return {
            criterion: await library.updateCriterion(
              actorUserId,
              criterionId,
              expectedVersion,
              criterion,
            ),
            summary: "Updated Criterion.",
          };
        },
      }),
      defineAgentTool({
        name: "create_criteria",
        title: "Create Criteria",
        description: "Create one named ordered Criteria permutation from existing Criterion IDs.",
        parameters: criteriaInputSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute(input, context) {
          const { actorUserId } = requireAgentActor(context);
          return {
            criteria: await library.createCriteria(actorUserId, input),
            summary: "Created Criteria.",
          };
        },
      }),
      defineAgentTool({
        name: "update_criteria",
        title: "Update Criteria",
        description:
          "Replace one named ordered Criteria permutation using its expected version for optimistic concurrency.",
        parameters: criteriaUpdateSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute({ criteriaId, expectedVersion, ...criteria }, context) {
          const { actorUserId } = requireAgentActor(context);
          return {
            criteria: await library.updateCriteria(
              actorUserId,
              criteriaId,
              expectedVersion,
              criteria,
            ),
            summary: "Updated Criteria.",
          };
        },
      }),
    ]);
  }
}
