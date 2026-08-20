/** Exposes prompt-bound target profile availability without leaking runtime construction into the browser. */

import { getApplicationServices } from "vibe-prompting/server";

import type { TargetProfileResponse } from "@/contracts/targets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const promptId = new URL(request.url).searchParams.get("promptId") ?? "";
  if (!UUID_PATTERN.test(promptId)) {
    return Response.json(
      { error: "Prompt ID must be a UUID." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }
  try {
    const services = await getApplicationServices();
    const profile = await services.targets.getProfileForPrompt(promptId);
    return Response.json({ profile } satisfies TargetProfileResponse, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) {
      return Response.json({ profile: null } satisfies TargetProfileResponse, {
        headers: NO_STORE_HEADERS,
      });
    }
    return Response.json(
      { error: "Target profile storage failed." },
      { headers: NO_STORE_HEADERS, status: 500 },
    );
  }
}
