/** Loads one exact immutable prompt revision and its adjacent parent body for focused history views. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptRevisionResponse } from "@/contracts/prompts";

import { promptErrorResponse, requireUuid } from "../../../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ promptId: string; revisionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { promptId, revisionId } = await context.params;
    requireUuid(promptId, "Prompt ID");
    requireUuid(revisionId, "Revision ID");
    const services = await getApplicationServices();
    const revision = await services.prompts.getRevision(promptId, revisionId);
    const parentMarkdown = revision.parentRevisionId
      ? (await services.prompts.getRevision(promptId, revision.parentRevisionId)).markdown
      : null;
    return Response.json(
      {
        parentMarkdown,
        revision,
      } satisfies PromptRevisionResponse,
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return promptErrorResponse(error);
  }
}
