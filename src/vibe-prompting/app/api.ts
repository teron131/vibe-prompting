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

import type { ApplicationServices } from "./application.ts";
import { projectServerError } from "./errors.ts";
import { registerCriteriaRoutes } from "./routes/criteria.ts";
import { registerEvaluationRoutes } from "./routes/evaluations.ts";
import { registerPromptRoutes } from "./routes/prompts.ts";
import { registerResultRoutes } from "./routes/results.ts";
import { getApplicationServices, registerShutdown } from "./runtime.ts";

/** Creates the Fastify adapter for the durable application services and OpenAPI contracts. */
export async function createApiServer(application?: ApplicationServices): Promise<FastifyInstance> {
  const services = application ?? (await getApplicationServices());
  const server = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  if (!application) server.addHook("onClose", () => services.close());
  server.addHook("onListen", async () => {
    const address = server.server.address();
    if (typeof address === "object" && address && !isLoopbackAddress(address.address)) {
      await server.close();
      throw new Error("The trusted Fastify adapter may listen only on a loopback address.");
    }
  });
  server.addHook("preHandler", async (request) => {
    if (services.closed)
      throw Object.assign(new Error("The application runtime is shutting down."), {
        statusCode: 503,
      });
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
    async () => ({ models: await services.getConfiguredModels() }),
  );

  registerPromptRoutes(server, services);
  registerEvaluationRoutes(server, services);
  registerCriteriaRoutes(server, services);
  registerResultRoutes(server, services);

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
    const projected = projectServerError(error, "The server could not complete the request.");
    if (projected.status >= 500) server.log.error({ err: error }, "HTTP request failed.");
    return reply.code(projected.status).send({ error: projected.message });
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
  const services = await getApplicationServices();
  const server = await createApiServer(services);
  registerShutdown(async () => {
    const closing = server.close();
    await services.close();
    await closing;
  });
  await server.listen({
    host: "127.0.0.1",
    port: Number(process.env.API_PORT ?? 3000),
  });
}
