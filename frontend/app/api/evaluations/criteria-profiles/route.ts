/** Exposes reusable criteria profile listing and creation through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import type { CriteriaProfileResponse, CriteriaProfilesResponse } from "@/contracts/evaluations";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET() {
  try {
    const services = await getApplicationServices();
    return Response.json(
      { profiles: await services.criteriaProfiles.list() } satisfies CriteriaProfilesResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    return Response.json(
      {
        profile: await services.criteriaProfiles.create(await request.json()),
      } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
