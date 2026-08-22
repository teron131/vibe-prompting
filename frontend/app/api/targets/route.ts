/** Exposes prompt-bound target profile availability without leaking runtime construction into the browser. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { TargetProfileResponse } from "@/contracts/targets";
import { NO_STORE_HEADERS, projectServerError } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireActiveSessionUser();
  try {
    const promptId = requireUuid(new URL(request.url).searchParams.get("promptId"), "Prompt ID");
    const services = await getApplicationServices();
    const profile = await services.targets.getProfileForPrompt(promptId);
    return Response.json(
      {
        profile: { configuration: profile.configuration, name: profile.name },
      } satisfies TargetProfileResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const projected = projectServerError(error, "Target profile storage failed.");
    if (projected.status === 404) {
      return Response.json({ profile: null } satisfies TargetProfileResponse, {
        headers: NO_STORE_HEADERS,
      });
    }
    return Response.json(
      { error: projected.message },
      { headers: NO_STORE_HEADERS, status: projected.status },
    );
  }
}
