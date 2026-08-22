/** Projects one prompt with immutable revisions and guards manual saves by expected revision identity. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { PromptDetail, PromptEditorSnapshot } from "@/contracts/prompts";
import {
  RequestValidationError,
  requireRecord,
  requireString,
  requireUuid,
} from "@/server/request";

import { projectPromptRevisionForViewer, promptErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ promptId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveSessionUser();
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
        revisions: revisions.map((revision) => projectPromptRevisionForViewer(revision, user.id)),
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
    const user = await requireActiveSessionUser();
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
    } else {
      if (record.action !== undefined)
        throw new RequestValidationError("Prompt action must be activate.");
      prompt = await services.prompts.appendHumanEdit(user.id, {
        promptId,
        markdown: requireString(record.markdown, "Prompt Markdown"),
        expectedActiveRevisionId: requireUuid(
          record.expectedActiveRevisionId,
          "Expected active revision ID",
        ),
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
    await requireActiveSessionUser();
    const { promptId } = await context.params;
    requireUuid(promptId, "Prompt ID");
    const record = requireRecord(await request.json());
    const expectedActiveRevisionId = requireUuid(
      record.expectedActiveRevisionId,
      "Expected active revision ID",
    );
    const services = await getApplicationServices();
    await services.prompts.deletePrompt(promptId, expectedActiveRevisionId);
    return Response.json({ promptId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return promptErrorResponse(error);
  }
}
