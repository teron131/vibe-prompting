/** Owns evaluation execution and exposes it through the Fastify API consumed by the frontend and mirrored by MCP. */

import { readFileSync } from "node:fs";

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

import { evaluatorGraph, type EvaluatorScore } from "../agents/evaluator/graph.ts";
import { createChatModel } from "../clients/llm.ts";
import { loadRuntimeConfig } from "../config.ts";
import type {
  EvaluationCriteria as InternalCriteria,
  EvaluationCriterion as InternalCriterion,
} from "../evaluation/schemas.ts";
import {
  type Criterion,
  type CriterionEvaluation,
  type EvaluationRequest,
  type EvaluationRun,
  requestSchema,
  type Target,
  targetSchema,
} from "./schemas.ts";

const targetModelSchema = z.string().trim().min(1).describe("Configured model ID to evaluate.");
const apiCaseSchema = requestSchema.shape.cases.element.extend({
  input: z.string().trim().min(1).describe("Text prompt to send to the target model."),
});
export const apiEvaluationSchema = requestSchema.extend({
  cases: z.array(apiCaseSchema).min(1),
  targetModel: targetModelSchema,
});

const FRONTEND_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
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

export async function evaluateRequest(rawRequest: unknown) {
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

export function getConfiguredModels() {
  const { models } = loadRuntimeConfig();
  return models.map(({ id, label }) => ({ id, label }));
}

export async function createApiServer(): Promise<FastifyInstance> {
  const frontend = readFileSync(new URL("../frontend.html", import.meta.url), "utf8");
  const server = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Vibe Prompting API",
        description: "Evaluate configured model responses against supplied criteria.",
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
    "/",
    {
      schema: { hide: true },
    },
    (_request, reply) => reply.headers(FRONTEND_HEADERS).type("text/html").send(frontend),
  );

  server.get(
    "/api/config",
    {
      schema: {
        description: "List the configured models available to the evaluation frontend.",
        summary: "List configured models",
        tags: ["evaluation"],
      },
    },
    () => ({ models: getConfiguredModels() }),
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
        error: "Invalid evaluation request.",
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

if (import.meta.main) {
  const server = await createApiServer();
  await server.listen({
    host: process.env.API_HOST ?? "127.0.0.1",
    port: Number(process.env.API_PORT ?? 3000),
  });
}
