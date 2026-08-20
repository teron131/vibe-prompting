/** Exposes one reusable criteria profile for reading, replacement, and deletion through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import type { CriteriaProfileResponse } from "@/contracts/evaluations";

import { evaluationErrorResponse, requireUuid } from "../../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

type Context = { params: Promise<{ profileId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const services = await getApplicationServices();
    return Response.json(
      { profile: await services.criteriaProfiles.get(profileId) } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const services = await getApplicationServices();
    return Response.json(
      {
        profile: await services.criteriaProfiles.update(profileId, await request.json()),
      } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const services = await getApplicationServices();
    await services.criteriaProfiles.delete(profileId);
    return new Response(null, { headers: NO_STORE_HEADERS, status: 204 });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
