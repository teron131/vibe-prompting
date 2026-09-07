/** Adapts persisted evaluation results, analytics, and allowlisted exploration to HTTP without reimplementing scoring or queries. */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  evaluationExplorerQuestionSchema,
  evaluationFiltersSchema,
  evaluationResultListInputSchema,
  evaluationStructuredQuerySchema,
  exploreEvaluations,
} from "../../evaluation/results/index.ts";
import type { ApplicationServices } from "../application.ts";

const caseParamsSchema = z.object({ caseId: z.uuid() });
const evaluationExplorerRequestSchema = z.object({
  question: evaluationExplorerQuestionSchema,
});

/** Registers result reads and validated exploration over the shared evaluation result service. */
export function registerResultRoutes(app: FastifyInstance, services: ApplicationServices): void {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get(
    "/api/evaluations/results",
    {
      schema: {
        description:
          "List paginated evaluation cases with run provenance and judge-attributed scores.",
        querystring: evaluationResultListInputSchema,
        summary: "List evaluation results",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return services.evaluationResults.listResults(request.query);
    },
  );

  server.get(
    "/api/evaluations/results/:caseId",
    {
      schema: {
        description:
          "Get one evaluation case with its complete provenance and judge-attributed scores.",
        params: caseParamsSchema,
        summary: "Get evaluation result",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        item: await services.evaluationResults.getResult(request.params.caseId),
        provenance: evaluationProvenance(),
      };
    },
  );

  server.get(
    "/api/evaluations/analytics",
    {
      schema: {
        description: "Aggregate filtered evaluation runs, cases, and typed scores in PostgreSQL.",
        querystring: evaluationFiltersSchema,
        summary: "Get evaluation analytics",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return services.evaluationResults.getAnalytics(request.query);
    },
  );

  server.post(
    "/api/evaluations/query",
    {
      schema: {
        body: evaluationStructuredQuerySchema,
        description:
          "Execute one allowlisted count, keyword count, grouped count, or numeric average query.",
        summary: "Query evaluation results",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return services.evaluationResults.query(request.body);
    },
  );

  server.post(
    "/api/evaluations/explorer",
    {
      schema: {
        body: evaluationExplorerRequestSchema,
        description:
          "Translate one plain-language question with the configured helper model at low reasoning effort and execute the validated query.",
        summary: "Explore evaluation results",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return exploreEvaluations(services.evaluationResults, request.body.question, services.models);
    },
  );
}

function evaluationProvenance() {
  return {
    source: "evaluation_storage" as const,
    generatedAt: new Date().toISOString(),
    syntheticExamplesIncluded: true,
  };
}
