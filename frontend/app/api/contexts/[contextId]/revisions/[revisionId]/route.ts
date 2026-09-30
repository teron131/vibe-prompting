/** Loads one exact immutable context revision and its adjacent parent body for focused history views. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ContextRevisionResponse } from "@/contracts/contexts";
import { requireUuid } from "@/server/request";

import { contextErrorResponse, projectContextRevisionForViewer } from "../../../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contextId: string; revisionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveSessionUser();
    const { contextId, revisionId } = await context.params;
    requireUuid(contextId, "Context ID");
    requireUuid(revisionId, "Revision ID");
    const services = await getApplicationServices();
    const revision = await services.contexts.getRevision(contextId, revisionId);
    const parentMarkdown = revision.parentRevisionId
      ? (await services.contexts.getRevision(contextId, revision.parentRevisionId)).markdown
      : null;
    return Response.json(
      {
        parentMarkdown,
        revision: projectContextRevisionForViewer(revision, user.id),
      } satisfies ContextRevisionResponse,
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return contextErrorResponse(error);
  }
}
