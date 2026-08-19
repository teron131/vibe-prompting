/** Adapts prompt storage and evaluation actions to the headless Fastify and OpenAPI surface mirrored by MCP. */

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

import { editPrompt } from "../agent/runtime.ts";
import { createChatModel } from "../clients/llm.ts";
import { evaluate, requestSchema } from "../evaluation/api.ts";
import { getModelSpendLimit } from "../model-spend-limit.ts";
import { PromptConflictError } from "../prompt-system/index.ts";
import {
  createApplicationServices,
  getApplicationServices,
  getConfiguredModels,
} from "../server.ts";

const modelIdSchema = z.string().trim().min(1).describe("Configured model ID.");
const promptIdSchema = z.string().uuid();
const promptParamsSchema = z.object({ promptId: promptIdSchema });
const createPromptRequestSchema = z.object({
  markdown: z.string().describe("Initial textual prompt markdown."),
  title: z.string().trim().min(1).describe("Human-readable prompt title."),
});
const editPromptRequestSchema = z.object({
  markdown: z.string().describe("Prompt markdown currently visible to the user."),
  instruction: z.string().trim().min(1).describe("Requested prompt change."),
  modelId: modelIdSchema.describe("Configured model used for the edit."),
  revisionId: promptIdSchema.describe("Revision the visible markdown was loaded from."),
});
const apiCaseSchema = requestSchema.shape.cases.element.extend({
  input: z.string().trim().min(1).describe("Text prompt to send to the target model."),
});
export const apiEvaluationSchema = requestSchema.extend({
  cases: z.array(apiCaseSchema).min(1),
  targetModel: modelIdSchema.describe("Configured model to evaluate."),
});

export async function evaluateRequest(rawRequest: unknown) {
  if (!getModelSpendLimit()) await getApplicationServices();
  const { targetModel, ...request } = apiEvaluationSchema.parse(rawRequest);
  const model = createChatModel({ model: targetModel });
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

export async function createApiServer(): Promise<FastifyInstance> {
  const services = await createApplicationServices();
  const prompts = services.prompts;
  const server = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.addHook("onClose", () => services.close());

  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Vibe Prompting API",
        description: "Edit durable text prompts and evaluate configured model responses.",
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
    (request) => prompts.createPrompt(request.body),
  );

  server.get(
    "/api/prompts",
    {
      schema: {
        description: "List saved prompts at their current revisions.",
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
      const currentPrompt = await prompts.getPrompt(request.params.promptId);
      if (currentPrompt.revisionId !== request.body.revisionId) {
        throw new PromptConflictError();
      }
      const edit = await editPrompt({
        markdown: request.body.markdown,
        instruction: request.body.instruction,
        modelId: request.body.modelId,
      });
      const prompt = await prompts.appendAiEdit({
        promptId: request.params.promptId,
        editedMarkdown: edit.markdown,
        expectedRevisionId: request.body.revisionId,
        instruction: request.body.instruction,
        visibleMarkdown: request.body.markdown,
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

if (import.meta.main) {
  const server = await createApiServer();
  await server.listen({
    host: process.env.API_HOST ?? "127.0.0.1",
    port: Number(process.env.API_PORT ?? 3000),
  });
}
