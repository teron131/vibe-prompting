/** Binds prompt creation and isolated AI editing to the trusted HTTP surface while Prompt System owns revisions and conflicts. */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { editPrompt } from "../../agents/openai-agents/prompt-edit.ts";
import { PromptConflictError } from "../../prompt-system/index.ts";
import type { ApplicationServices } from "../application.ts";
import { actorSchema, modelIdSchema } from "./schemas.ts";

const promptIdSchema = z.uuid();
const promptParamsSchema = z.object({ promptId: promptIdSchema });
const createPromptRequestSchema = z.object({
  actorUserId: actorSchema.shape.actorUserId,
  title: z.string().trim().min(1).describe("Human-readable prompt title."),
  markdown: z.string().describe("Initial textual prompt markdown."),
});
const editPromptRequestSchema = z.object({
  actorUserId: actorSchema.shape.actorUserId,
  revisionId: promptIdSchema.describe("Revision the visible markdown was loaded from."),
  markdown: z.string().describe("Prompt markdown currently visible to the user."),
  instruction: z.string().trim().min(1).describe("Requested prompt change."),
  modelId: modelIdSchema.describe("Configured model used for the edit."),
});

/** Registers prompt operations while preserving the visible-revision check before model execution. */
export function registerPromptRoutes(app: FastifyInstance, services: ApplicationServices): void {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const prompts = services.prompts;
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
        modelContext: services.models,
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
}
