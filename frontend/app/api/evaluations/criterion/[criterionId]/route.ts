/** Exposes one shared Criterion for reading, replacement, and guarded deletion through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { SavedCriterionResponse } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requirePositiveInteger, requireRecord, requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ criterionId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { criterionId } = await context.params;
    requireUuid(criterionId, "criterionId");
    const services = await getApplicationServices();
    return Response.json(
      {
        criterion: await services.criterion.getCriterion(criterionId),
      } satisfies SavedCriterionResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireActiveSessionUser();
    const { criterionId } = await context.params;
    requireUuid(criterionId, "criterionId");
    const body = requireRecord(await request.json());
    const expectedVersion = requirePositiveInteger(body.expectedVersion, "expectedVersion");
    const services = await getApplicationServices();
    return Response.json(
      {
        criterion: await services.criterion.updateCriterion(
          user.id,
          criterionId,
          expectedVersion,
          body,
        ),
      } satisfies SavedCriterionResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { criterionId } = await context.params;
    requireUuid(criterionId, "criterionId");
    const body = requireRecord(await request.json());
    const expectedVersion = requirePositiveInteger(body.expectedVersion, "expectedVersion");
    const services = await getApplicationServices();
    await services.criterion.deleteCriterion(criterionId, expectedVersion);
    return new Response(null, { headers: NO_STORE_HEADERS, status: 204 });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
