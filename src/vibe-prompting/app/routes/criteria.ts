/** Adapts reusable Criterion and ordered Criteria CRUD to HTTP while the library owns validation, conflicts, and historical independence. */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { criteriaInputSchema, savedCriterionInputSchema } from "../../criteria/index.ts";
import type { ApplicationServices } from "../application.ts";
import { actorSchema } from "./schemas.ts";

const criterionParamsSchema = z.object({ criterionId: z.uuid() });
const criteriaParamsSchema = z.object({ criteriaId: z.uuid() });
const createCriterionRequestSchema = savedCriterionInputSchema.and(actorSchema);
const updateCriterionRequestSchema = createCriterionRequestSchema.and(
  z.object({ expectedVersion: z.number().int().positive() }),
);
const createCriteriaRequestSchema = criteriaInputSchema.extend(actorSchema.shape);
const updateCriteriaRequestSchema = createCriteriaRequestSchema.extend({
  expectedVersion: z.number().int().positive(),
});
const deleteCriteriaResourceRequestSchema = actorSchema.extend({
  expectedVersion: z.number().int().positive(),
});

/** Registers Criterion and Criteria CRUD with active actors and optimistic versions supplied by the HTTP request. */
export function registerCriteriaRoutes(app: FastifyInstance, services: ApplicationServices): void {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get(
    "/api/evaluations/criterion",
    {
      schema: {
        description: "List reusable named Criterion resources.",
        summary: "List Criterion",
        tags: ["evaluation"],
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { criterion: await services.criterion.listCriterion() };
    },
  );

  server.post(
    "/api/evaluations/criterion",
    {
      schema: {
        body: createCriterionRequestSchema,
        description: "Create one reusable named Criterion.",
        summary: "Create Criterion",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, ...input } = request.body;
      const criterion = await services.criterion.createCriterion(actorUserId, input);
      return reply.header("cache-control", "no-store").code(201).send({ criterion });
    },
  );

  server.get(
    "/api/evaluations/criterion/:criterionId",
    {
      schema: {
        description: "Get one reusable named Criterion.",
        params: criterionParamsSchema,
        summary: "Get Criterion",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return { criterion: await services.criterion.getCriterion(request.params.criterionId) };
    },
  );

  server.put(
    "/api/evaluations/criterion/:criterionId",
    {
      schema: {
        body: updateCriterionRequestSchema,
        description: "Replace one reusable named Criterion.",
        params: criterionParamsSchema,
        summary: "Update Criterion",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, expectedVersion, ...input } = request.body;
      const criterion = await services.criterion.updateCriterion(
        actorUserId,
        request.params.criterionId,
        expectedVersion,
        input,
      );
      return reply.header("cache-control", "no-store").send({ criterion });
    },
  );

  server.delete(
    "/api/evaluations/criterion/:criterionId",
    {
      schema: {
        body: deleteCriteriaResourceRequestSchema,
        description: "Delete one Criterion and remove it from affected Criteria compositions.",
        params: criterionParamsSchema,
        summary: "Delete Criterion",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const deletion = await services.criterion.deleteCriterion(
        request.body.actorUserId,
        request.params.criterionId,
        request.body.expectedVersion,
      );
      return reply.header("cache-control", "no-store").send(deletion);
    },
  );

  server.get(
    "/api/evaluations/criteria",
    {
      schema: {
        description: "List named Criteria permutations composed from shared Criterion resources.",
        summary: "List Criteria",
        tags: ["evaluation"],
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { criteria: await services.criterion.listCriteria() };
    },
  );

  server.post(
    "/api/evaluations/criteria",
    {
      schema: {
        body: createCriteriaRequestSchema,
        description: "Create named Criteria from an ordered sequence of shared Criterion IDs.",
        summary: "Create Criteria",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, ...input } = request.body;
      const criteria = await services.criterion.createCriteria(actorUserId, input);
      return reply.header("cache-control", "no-store").code(201).send({ criteria });
    },
  );

  server.get(
    "/api/evaluations/criteria/:criteriaId",
    {
      schema: {
        description: "Get one named Criteria permutation.",
        params: criteriaParamsSchema,
        summary: "Get Criteria",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return { criteria: await services.criterion.getCriteria(request.params.criteriaId) };
    },
  );

  server.put(
    "/api/evaluations/criteria/:criteriaId",
    {
      schema: {
        body: updateCriteriaRequestSchema,
        description: "Replace one Criteria name and ordered Criterion sequence.",
        params: criteriaParamsSchema,
        summary: "Update Criteria",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, expectedVersion, ...input } = request.body;
      const criteria = await services.criterion.updateCriteria(
        actorUserId,
        request.params.criteriaId,
        expectedVersion,
        input,
      );
      return reply.header("cache-control", "no-store").send({ criteria });
    },
  );

  server.delete(
    "/api/evaluations/criteria/:criteriaId",
    {
      schema: {
        body: deleteCriteriaResourceRequestSchema,
        description: "Delete one Criteria permutation without changing historical runs.",
        params: criteriaParamsSchema,
        summary: "Delete Criteria",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      await services.criterion.deleteCriteria(
        request.params.criteriaId,
        request.body.expectedVersion,
      );
      return reply.header("cache-control", "no-store").code(204).send();
    },
  );
}
