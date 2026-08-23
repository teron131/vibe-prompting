/** Exposes one ordered Criteria permutation for reading, replacement, and deletion through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { CriteriaResponse } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requirePositiveInteger, requireRecord, requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ criteriaId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { criteriaId } = await context.params;
    requireUuid(criteriaId, "criteriaId");
    const services = await getApplicationServices();
    return Response.json(
      { criteria: await services.criterion.getCriteria(criteriaId) } satisfies CriteriaResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireActiveSessionUser();
    const { criteriaId } = await context.params;
    requireUuid(criteriaId, "criteriaId");
    const body = requireRecord(await request.json());
    const expectedVersion = requirePositiveInteger(body.expectedVersion, "expectedVersion");
    const services = await getApplicationServices();
    return Response.json(
      {
        criteria: await services.criterion.updateCriteria(
          user.id,
          criteriaId,
          expectedVersion,
          body,
        ),
      } satisfies CriteriaResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { criteriaId } = await context.params;
    requireUuid(criteriaId, "criteriaId");
    const body = requireRecord(await request.json());
    const expectedVersion = requirePositiveInteger(body.expectedVersion, "expectedVersion");
    const services = await getApplicationServices();
    await services.criterion.deleteCriteria(criteriaId, expectedVersion);
    return new Response(null, { headers: NO_STORE_HEADERS, status: 204 });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
