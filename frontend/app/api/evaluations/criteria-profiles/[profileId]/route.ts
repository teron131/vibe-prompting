/** Exposes one reusable criteria profile for reading, replacement, and deletion through the browser evaluation API. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { CriteriaProfileResponse } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ profileId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const services = await getApplicationServices();
    return Response.json(
      { profile: await services.criteriaProfiles.get(profileId) } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireActiveSessionUser();
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const body: unknown = await request.json();
    const expectedVersion = requireExpectedVersion(body);
    const services = await getApplicationServices();
    return Response.json(
      {
        profile: await services.criteriaProfiles.update(user.id, profileId, expectedVersion, body),
      } satisfies CriteriaProfileResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireActiveSessionUser();
    const { profileId } = await context.params;
    requireUuid(profileId, "profileId");
    const expectedVersion = requireExpectedVersion(await request.json());
    const services = await getApplicationServices();
    await services.criteriaProfiles.delete(profileId, expectedVersion);
    return new Response(null, { headers: NO_STORE_HEADERS, status: 204 });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

function requireExpectedVersion(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CriteriaRequestError("Request body must contain a JSON object.");
  }
  const version = (value as Record<string, unknown>).expectedVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new CriteriaRequestError("Expected version must be a positive integer.");
  }
  return version as number;
}

class CriteriaRequestError extends Error {
  readonly statusCode = 400;
}
