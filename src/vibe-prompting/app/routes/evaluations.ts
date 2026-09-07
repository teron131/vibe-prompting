/** Adapts synchronous judging and durable evaluation runs and batches to HTTP without owning their execution lifecycle. */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { createModel } from "../../clients/llm/langchain.ts";
import { evaluate, requestSchema } from "../../evaluation/api.ts";
import {
  evaluationBatchInputSchema,
  evaluationRunInputSchema,
} from "../../evaluation/runs/index.ts";
import type { ApplicationServices } from "../application.ts";
import { actorSchema, modelIdSchema, viewerQuerySchema } from "./schemas.ts";

const runParamsSchema = z.object({ runId: z.uuid() });
const evaluationRunsQuerySchema = z.object({
  viewerUserId: z.uuid(),
  promptId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const evaluationBatchStatusQuerySchema = z.object({
  viewerUserId: z.uuid(),
  runId: z.union([z.uuid(), z.array(z.uuid()).min(1).max(200)]),
});
const startEvaluationRequestSchema = evaluationRunInputSchema.extend(actorSchema.shape);
const startEvaluationBatchRequestSchema = evaluationBatchInputSchema.extend(actorSchema.shape);
const apiCaseSchema = evaluationRunInputSchema.shape.cases.element.extend({
  input: evaluationRunInputSchema.shape.cases.element.shape.input.describe(
    "Text prompt to send to the target model.",
  ),
});
const apiEvaluationSchema = requestSchema.extend({
  cases: z.array(apiCaseSchema).min(1),
  targetModel: modelIdSchema.describe("Configured model to evaluate."),
});

/** Registers immediate judging, batch submission, and historical run reads using canonical evaluation schemas. */
export function registerEvaluationRoutes(
  app: FastifyInstance,
  services: ApplicationServices,
): void {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.post(
    "/api/evaluate",
    {
      schema: {
        body: apiEvaluationSchema,
        description: "Run model outputs through the configured evaluation workflow.",
        summary: "Evaluate model responses",
        tags: ["evaluation"],
      },
    },
    (request) => evaluateRequest(request.body, services),
  );

  server.get(
    "/api/evaluations",
    {
      schema: {
        description: "List durable evaluation runs, optionally scoped to one prompt.",
        querystring: evaluationRunsQuerySchema,
        summary: "List evaluation runs",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const { viewerUserId, ...input } = request.query;
      return {
        runs: await services.evaluations.listRuns(viewerUserId, input),
      };
    },
  );

  server.post(
    "/api/evaluations",
    {
      schema: {
        body: startEvaluationRequestSchema,
        description:
          "Start one durable evaluation run and return immediately while it executes in the server process.",
        summary: "Start evaluation run",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, ...input } = request.body;
      const run = await services.evaluations.startHumanRun(actorUserId, input);
      return reply.header("cache-control", "no-store").code(202).send(run);
    },
  );

  server.post(
    "/api/evaluations/preview",
    {
      schema: {
        body: evaluationBatchInputSchema,
        description:
          "Expand an evaluation batch into its exact execution manifest without starting any runs.",
        summary: "Preview evaluation batch",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return services.evaluations.previewBatch(request.body);
    },
  );

  server.get(
    "/api/evaluations/batches",
    {
      schema: {
        description: "Reload the current status of between one and 200 evaluation runs.",
        querystring: evaluationBatchStatusQuerySchema,
        summary: "Get evaluation batch status",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const runIds = Array.isArray(request.query.runId)
        ? request.query.runId
        : [request.query.runId];
      reply.header("cache-control", "no-store");
      return {
        runs: await Promise.all(
          runIds.map((runId) =>
            services.evaluations.getRunSummary(request.query.viewerUserId, runId),
          ),
        ),
      };
    },
  );

  server.post(
    "/api/evaluations/batches",
    {
      schema: {
        body: startEvaluationBatchRequestSchema,
        description:
          "Start a server-expanded evaluation batch and return immediately while its runs execute asynchronously.",
        summary: "Start evaluation batch",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, ...input } = request.body;
      const batch = await services.evaluations.startHumanBatch(actorUserId, input);
      return reply.header("cache-control", "no-store").code(202).send(batch);
    },
  );

  server.get(
    "/api/evaluations/:runId",
    {
      schema: {
        description:
          "Get one immutable evaluation report and its compatible Boolean score history.",
        params: runParamsSchema,
        querystring: viewerQuerySchema,
        summary: "Get evaluation run",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const [run, trend] = await Promise.all([
        services.evaluationResults.getRun(request.query.viewerUserId, request.params.runId),
        services.evaluationResults.getCompatibleBooleanTrend(request.params.runId),
      ]);
      return reply.header("cache-control", "no-store").send({ run, trend });
    },
  );
}

/** Invokes the configured Target model for an HTTP request already validated by Fastify. */
async function evaluateRequest(
  { targetModel, ...request }: z.infer<typeof apiEvaluationSchema>,
  services: ApplicationServices,
) {
  const model = createModel({ model: targetModel }, services.models);
  return evaluate(
    {
      model: targetModel,
      async invoke(input: unknown) {
        if (typeof input !== "string") {
          throw new Error("API evaluation inputs must be strings.");
        }
        return (await model.invoke(input)).text;
      },
    },
    request,
    { engine: services.evaluator },
  );
}
