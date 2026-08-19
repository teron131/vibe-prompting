/** Projects one prompt with immutable revisions and guards manual saves by expected revision identity. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptCurrent, PromptDetail } from "@/contracts/prompts";

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
      services.prompts.getPrompt(promptId),
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
    const expectedRevisionId = requireUuid(record.expectedRevisionId, "Expected revision ID");
    const services = await getApplicationServices();
    let prompt: PromptCurrent;
    if (record.action === "undo") {
      prompt = await services.prompts.undo(promptId, expectedRevisionId);
    } else if (record.action === "redo") {
      prompt = await services.prompts.redo(promptId, expectedRevisionId);
    } else {
      if (record.action !== undefined)
        throw new PromptRequestError("Prompt action must be undo or redo.");
      prompt = await services.prompts.appendHumanEdit({
        promptId,
        markdown: requireString(record.markdown, "Prompt Markdown"),
        expectedRevisionId,
      });
    }
    return Response.json(prompt satisfies PromptCurrent, {
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
