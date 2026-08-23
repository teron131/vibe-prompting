/** Exposes shared Criterion listing and creation through the authenticated browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { CriterionLibraryResponse, SavedCriterionResponse } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      { criterion: await services.criterion.listCriterion() } satisfies CriterionLibraryResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      {
        criterion: await services.criterion.createCriterion(user.id, await request.json()),
      } satisfies SavedCriterionResponse,
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
