/** Adapts application services to a loopback-only Fastify surface for trusted local automation with validated active user IDs. */

import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

import { editPrompt } from "../agents/openai-agents/runtime.ts";
import { createModel } from "../clients/llm/langchain.ts";
import { evaluate, requestSchema } from "../evaluation/api.ts";
import { criteriaProfileInputSchema } from "../evaluation/criteria-profiles.ts";
import {
  evaluationExplorerQuestionSchema,
  evaluationFiltersSchema,
  evaluationResultListInputSchema,
  evaluationStructuredQuerySchema,
  exploreEvaluations,
} from "../evaluation/results/index.ts";
import { evaluationBatchInputSchema, evaluationRunInputSchema } from "../evaluation/runs/index.ts";
import { PromptConflictError } from "../prompt-system/index.ts";
import {
  createApplicationServices,
  getApplicationServices,
  getConfiguredModels,
} from "../server.ts";

const modelIdSchema = z.string().trim().min(1).describe("Configured model ID.");
const promptIdSchema = z.uuid();
const promptParamsSchema = z.object({ promptId: promptIdSchema });
const runParamsSchema = z.object({ runId: z.uuid() });
const caseParamsSchema = z.object({ caseId: z.uuid() });
const criteriaProfileParamsSchema = z.object({ profileId: z.uuid() });
const actorSchema = z.object({
  actorUserId: z.uuid().describe("Active application user initiating the mutation."),
});
const evaluationRunsQuerySchema = z.object({
  viewerUserId: z.uuid(),
  promptId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const evaluationBatchStatusQuerySchema = z.object({
  viewerUserId: z.uuid(),
  runId: z.union([z.uuid(), z.array(z.uuid()).min(1).max(200)]),
});
const evaluationExplorerRequestSchema = z.object({
  question: evaluationExplorerQuestionSchema,
});
const createPromptRequestSchema = z.object({
  actorUserId: z.uuid().describe("Active application user initiating the mutation."),
  title: z.string().trim().min(1).describe("Human-readable prompt title."),
  markdown: z.string().describe("Initial textual prompt markdown."),
});
const createCriteriaProfileRequestSchema = criteriaProfileInputSchema.extend(actorSchema.shape);
const updateCriteriaProfileRequestSchema = createCriteriaProfileRequestSchema.extend({
  expectedVersion: z.number().int().positive(),
});
const deleteCriteriaProfileRequestSchema = actorSchema.extend({
  expectedVersion: z.number().int().positive(),
});
const startEvaluationRequestSchema = evaluationRunInputSchema.extend(actorSchema.shape);
const startEvaluationBatchRequestSchema = evaluationBatchInputSchema.extend(actorSchema.shape);
const viewerQuerySchema = z.object({ viewerUserId: z.uuid() });
const editPromptRequestSchema = z.object({
  actorUserId: z.uuid().describe("Active application user initiating the mutation."),
  revisionId: promptIdSchema.describe("Revision the visible markdown was loaded from."),
  markdown: z.string().describe("Prompt markdown currently visible to the user."),
  instruction: z.string().trim().min(1).describe("Requested prompt change."),
  modelId: modelIdSchema.describe("Configured model used for the edit."),
});
const apiCaseSchema = requestSchema.shape.cases.element.extend({
  input: z.string().trim().min(1).describe("Text prompt to send to the target model."),
});
export const apiEvaluationSchema = requestSchema.extend({
  cases: z.array(apiCaseSchema).min(1),
  targetModel: modelIdSchema.describe("Configured model to evaluate."),
});

/** Validates one synchronous evaluation request and invokes the configured target model. */
export async function evaluateRequest(rawRequest: unknown) {
  await getApplicationServices();
  const { targetModel, ...request } = apiEvaluationSchema.parse(rawRequest);
  const model = createModel({ model: targetModel });
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
  );
}

function evaluationProvenance() {
  return {
    source: "evaluation_storage" as const,
    generatedAt: new Date().toISOString(),
    syntheticExamplesIncluded: true,
  };
}

/** Creates the Fastify adapter for the durable application services and OpenAPI contracts. */
export async function createApiServer(): Promise<FastifyInstance> {
  const services = await createApplicationServices();
  const prompts = services.prompts;
  const server = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.addHook("onClose", () => services.close());
  server.addHook("onListen", async () => {
    const address = server.server.address();
    if (typeof address === "object" && address && !isLoopbackAddress(address.address)) {
      await server.close();
      throw new Error("The trusted Fastify adapter may listen only on a loopback address.");
    }
  });
  server.addHook("preHandler", async (request) => {
    const userId =
      readUserId(request.body, "actorUserId") ?? readUserId(request.query, "viewerUserId");
    if (userId) await services.auth.requireActiveUser(userId);
  });

  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Vibe Prompting API",
        description:
          "Edit durable prompts, execute asynchronous evaluations, and analyze their persisted results.",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
  });
  await server.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
  });

  server.get(
    "/api/config",
    {
      schema: {
        description: "List the configured models available to the frontend.",
        summary: "List configured models",
        tags: ["evaluation"],
      },
    },
    async () => ({ models: await getConfiguredModels() }),
  );

  server.post(
    "/api/prompts",
    {
      schema: {
        body: createPromptRequestSchema,
        description: "Create a text prompt with its initial immutable revision.",
        summary: "Create prompt",
        tags: ["prompts"],
      },
    },
    (request) => {
      const { actorUserId, ...input } = request.body;
      return prompts.createPrompt(actorUserId, input);
    },
  );

  server.get(
    "/api/prompts",
    {
      schema: {
        description: "List saved prompts at their active revisions.",
        summary: "List prompts",
        tags: ["prompts"],
      },
    },
    async () => ({ prompts: await prompts.listPrompts() }),
  );

  server.post(
    "/api/prompts/:promptId/edits",
    {
      schema: {
        body: editPromptRequestSchema,
        description:
          "Persist any visible human change, edit temporary markdown with AI, and append the result.",
        params: promptParamsSchema,
        summary: "Edit prompt with AI",
        tags: ["prompts"],
      },
    },
    async (request) => {
      const activePrompt = await prompts.getPrompt(request.params.promptId);
      if (activePrompt.activeRevisionId !== request.body.revisionId) {
        throw new PromptConflictError(activePrompt.activeRevisionId);
      }
      const edit = await editPrompt({
        markdown: request.body.markdown,
        instruction: request.body.instruction,
        modelId: request.body.modelId,
      });
      const prompt = await prompts.appendAiEdit(request.body.actorUserId, {
        promptId: request.params.promptId,
        expectedActiveRevisionId: request.body.revisionId,
        visibleMarkdown: request.body.markdown,
        instruction: request.body.instruction,
        editedMarkdown: edit.markdown,
      });
      return { prompt, model: edit.model.id, output: edit.message };
    },
  );

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
    (request) => evaluateRequest(request.body),
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
    "/api/evaluations/criteria-profiles",
    {
      schema: {
        description: "List reusable criteria profiles.",
        summary: "List criteria profiles",
        tags: ["evaluation"],
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { profiles: await services.criteriaProfiles.list() };
    },
  );

  server.post(
    "/api/evaluations/criteria-profiles",
    {
      schema: {
        body: createCriteriaProfileRequestSchema,
        description: "Create a reusable criteria profile.",
        summary: "Create criteria profile",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, ...input } = request.body;
      const profile = await services.criteriaProfiles.create(actorUserId, input);
      return reply.header("cache-control", "no-store").code(201).send({ profile });
    },
  );

  server.get(
    "/api/evaluations/criteria-profiles/:profileId",
    {
      schema: {
        description: "Get one reusable criteria profile.",
        params: criteriaProfileParamsSchema,
        summary: "Get criteria profile",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return { profile: await services.criteriaProfiles.get(request.params.profileId) };
    },
  );

  server.put(
    "/api/evaluations/criteria-profiles/:profileId",
    {
      schema: {
        body: updateCriteriaProfileRequestSchema,
        description: "Replace one reusable criteria profile.",
        params: criteriaProfileParamsSchema,
        summary: "Update criteria profile",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      const { actorUserId, expectedVersion, ...input } = request.body;
      const profile = await services.criteriaProfiles.update(
        actorUserId,
        request.params.profileId,
        expectedVersion,
        input,
      );
      return reply.header("cache-control", "no-store").send({ profile });
    },
  );

  server.delete(
    "/api/evaluations/criteria-profiles/:profileId",
    {
      schema: {
        body: deleteCriteriaProfileRequestSchema,
        description: "Delete one user-created criteria profile.",
        params: criteriaProfileParamsSchema,
        summary: "Delete criteria profile",
        tags: ["evaluation"],
      },
    },
    async (request, reply) => {
      await services.criteriaProfiles.delete(
        request.params.profileId,
        request.body.expectedVersion,
      );
      return reply.header("cache-control", "no-store").code(204).send();
    },
  );

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
      return exploreEvaluations(services.evaluationResults, request.body.question);
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
        services.evaluations.getRun(request.query.viewerUserId, request.params.runId),
        services.evaluations.getCompatibleBooleanTrend(request.params.runId),
      ]);
      return reply.header("cache-control", "no-store").send({ run, trend });
    },
  );

  server.get(
    "/healthz",
    {
      schema: { hide: true },
    },
    (_request, reply) => reply.type("text/plain").send("ok"),
  );

  server.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: "Invalid request.",
        issues: error.validation,
      });
    }
    if (error instanceof SyntaxError) {
      return reply.code(400).send({ error: "Request body must contain valid JSON." });
    }
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    return reply
      .code(statusCode)
      .send({ error: error instanceof Error ? error.message : String(error) });
  });

  return server;
}

function readUserId(value: unknown, field: "actorUserId" | "viewerUserId"): string | undefined {
  if (!value || typeof value !== "object" || !(field in value)) return undefined;
  const userId = (value as Record<string, unknown>)[field];
  return typeof userId === "string" ? userId : undefined;
}

function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

if (import.meta.main) {
  const server = await createApiServer();
  await server.listen({
    host: "127.0.0.1",
    port: Number(process.env.API_PORT ?? 3000),
  });
}
