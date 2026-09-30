/** Binds context creation and isolated AI editing to the trusted HTTP surface while Context System owns revisions and conflicts. */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { editContext } from "../../agents/openai-agents/context-edit.ts";
import { ContextConflictError } from "../../context-system/index.ts";
import type { ApplicationServices } from "../application.ts";
import { actorSchema, modelIdSchema } from "./schemas.ts";

const contextIdSchema = z.uuid();
const contextParamsSchema = z.object({ contextId: contextIdSchema });
const createContextRequestSchema = z.object({
  actorUserId: actorSchema.shape.actorUserId,
  title: z.string().trim().min(1).describe("Human-readable context title."),
  markdown: z.string().describe("Initial textual context markdown."),
});
const editContextRequestSchema = z.object({
  actorUserId: actorSchema.shape.actorUserId,
  revisionId: contextIdSchema.describe("Revision the visible markdown was loaded from."),
  markdown: z.string().describe("Context markdown currently visible to the user."),
  instruction: z.string().trim().min(1).describe("Requested context change."),
  modelId: modelIdSchema.describe("Configured model used for the edit."),
});

/** Registers context operations while preserving the visible-revision check before model execution. */
export function registerContextRoutes(app: FastifyInstance, services: ApplicationServices): void {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const contexts = services.contexts;
  server.post(
    "/api/contexts",
    {
      schema: {
        body: createContextRequestSchema,
        description: "Create a text context with its initial immutable revision.",
        summary: "Create context",
        tags: ["contexts"],
      },
    },
    (request) => {
      const { actorUserId, ...input } = request.body;
      return contexts.createContext(actorUserId, input);
    },
  );

  server.get(
    "/api/contexts",
    {
      schema: {
        description: "List saved contexts at their active revisions.",
        summary: "List contexts",
        tags: ["contexts"],
      },
    },
    async () => ({ contexts: await contexts.listContexts() }),
  );

  server.post(
    "/api/contexts/:contextId/edits",
    {
      schema: {
        body: editContextRequestSchema,
        description:
          "Persist any visible human change, edit temporary markdown with AI, and append the result.",
        params: contextParamsSchema,
        summary: "Edit context with AI",
        tags: ["contexts"],
      },
    },
    async (request) => {
      const activeContext = await contexts.getContext(request.params.contextId);
      if (activeContext.activeRevisionId !== request.body.revisionId) {
        throw new ContextConflictError(activeContext.activeRevisionId);
      }
      const edit = await editContext({
        markdown: request.body.markdown,
        instruction: request.body.instruction,
        modelId: request.body.modelId,
        modelContext: services.models,
      });
      const context = await contexts.appendAiEdit(request.body.actorUserId, {
        contextId: request.params.contextId,
        expectedActiveRevisionId: request.body.revisionId,
        visibleMarkdown: request.body.markdown,
        instruction: request.body.instruction,
        editedMarkdown: edit.markdown,
      });
      return { context, model: edit.model.id, output: edit.message };
    },
  );
}
