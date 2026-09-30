/** Projects one context with immutable revisions and guards manual saves by expected revision identity. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ContextDetail, ContextEditorSnapshot } from "@/contracts/contexts";
import {
  RequestValidationError,
  requireRecord,
  requireString,
  requireUuid,
} from "@/server/request";

import { contextErrorResponse, projectContextRevisionForViewer } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contextId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const user = await requireActiveSessionUser();
    const { contextId } = await route.params;
    requireUuid(contextId, "Context ID");
    const services = await getApplicationServices();
    const [context, revisions] = await Promise.all([
      services.contexts.getContext(contextId),
      services.contexts.listRevisions(contextId),
    ]);
    return Response.json(
      {
        context,
        revisions: revisions.map((revision) => projectContextRevisionForViewer(revision, user.id)),
      } satisfies ContextDetail,
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return contextErrorResponse(error);
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const user = await requireActiveSessionUser();
    const { contextId } = await route.params;
    requireUuid(contextId, "Context ID");
    const record = requireRecord(await request.json());
    const services = await getApplicationServices();
    let context: ContextEditorSnapshot;
    if (record.action === "activate") {
      context = await services.contexts.activateRevision(
        contextId,
        requireUuid(record.revisionId, "Revision ID"),
        requireUuid(record.expectedActiveRevisionId, "Expected active revision ID"),
      );
    } else {
      if (record.action !== undefined)
        throw new RequestValidationError("Context action must be activate.");
      context = await services.contexts.appendHumanEdit(user.id, {
        contextId,
        markdown: requireString(record.markdown, "Context Markdown"),
        expectedActiveRevisionId: requireUuid(
          record.expectedActiveRevisionId,
          "Expected active revision ID",
        ),
      });
    }
    return Response.json(context satisfies ContextEditorSnapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return contextErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireActiveSessionUser();
    const { contextId } = await context.params;
    requireUuid(contextId, "Context ID");
    const record = requireRecord(await request.json());
    const expectedActiveRevisionId = requireUuid(
      record.expectedActiveRevisionId,
      "Expected active revision ID",
    );
    const services = await getApplicationServices();
    await services.contexts.deleteContext(contextId, expectedActiveRevisionId);
    return Response.json({ contextId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return contextErrorResponse(error);
  }
}
