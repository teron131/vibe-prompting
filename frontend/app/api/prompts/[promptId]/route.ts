/** Projects one prompt with immutable revisions and guards manual saves by expected revision identity. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptDetail, PromptSummary } from "@/contracts/prompts";

import { promptErrorResponse, requireRecord, requireString, requireUuid } from "../request";

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
    return Response.json({ prompt, revisions } satisfies PromptDetail, {
      headers: { "cache-control": "no-store" },
    });
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
    const markdown = requireString(record.markdown, "Prompt Markdown");
    const services = await getApplicationServices();
    const payload = await services.prompts.appendManualEdit({
      expectedRevisionId,
      markdown,
      promptId,
    });
    return Response.json(payload satisfies PromptSummary, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return promptErrorResponse(error);
  }
}
