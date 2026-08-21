/** Projects one prompt with immutable revisions and guards manual saves by expected revision identity. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptDetail, PromptEditorSnapshot } from "@/contracts/prompts";

import {
  promptErrorResponse,
  PromptRequestError,
  requireRecord,
  requireString,
  requireUuid,
} from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ promptId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { promptId } = await context.params;
    requireUuid(promptId, "Prompt ID");
    const services = await getApplicationServices();
    const [prompt, revisions] = await Promise.all([
      services.prompts.getEditorPrompt(promptId),
      services.prompts.listRevisions(promptId),
    ]);
    return Response.json(
      {
        prompt,
        revisions,
      } satisfies PromptDetail,
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return promptErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { promptId } = await context.params;
    requireUuid(promptId, "Prompt ID");
    const record = requireRecord(await request.json());
    const services = await getApplicationServices();
    let prompt: PromptEditorSnapshot;
    if (record.action === "activate") {
      prompt = await services.prompts.activateRevision(
        promptId,
        requireUuid(record.revisionId, "Revision ID"),
        requireUuid(record.expectedActiveRevisionId, "Expected active revision ID"),
      );
    } else if (record.action === "undo") {
      prompt = await services.prompts.undo(
        promptId,
        requireUuid(record.expectedRevisionId, "Expected revision ID"),
      );
    } else if (record.action === "redo") {
      prompt = await services.prompts.redo(
        promptId,
        requireUuid(record.expectedRevisionId, "Expected revision ID"),
      );
    } else {
      if (record.action !== undefined)
        throw new PromptRequestError("Prompt action must be activate, undo, or redo.");
      prompt = await services.prompts.appendHumanEdit({
        promptId,
        markdown: requireString(record.markdown, "Prompt Markdown"),
        expectedRevisionId: requireUuid(record.expectedRevisionId, "Expected revision ID"),
      });
    }
    return Response.json(prompt satisfies PromptEditorSnapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return promptErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { promptId } = await context.params;
    requireUuid(promptId, "Prompt ID");
    const record = requireRecord(await request.json());
    const expectedRevisionId = requireUuid(record.expectedRevisionId, "Expected revision ID");
    const services = await getApplicationServices();
    await services.prompts.deletePrompt(promptId, expectedRevisionId);
    return Response.json({ promptId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return promptErrorResponse(error);
  }
}
