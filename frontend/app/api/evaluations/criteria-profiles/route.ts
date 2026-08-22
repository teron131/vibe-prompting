/** Exposes reusable criteria profile listing and creation through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { CriteriaProfileResponse, CriteriaProfilesResponse } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      { profiles: await services.criteriaProfiles.list() } satisfies CriteriaProfilesResponse,
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
        profile: await services.criteriaProfiles.create(user.id, await request.json()),
      } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
