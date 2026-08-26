/** Starts durable static or generative Scenario Runs against exact prompt revisions. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ScenarioRunResponse } from "@/contracts/scenario-runs";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      (await services.scenarios.startHumanRun(
        user.id,
        await request.json(),
      )) satisfies ScenarioRunResponse,
      { status: 202, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Scenario Run storage failed.");
  }
}
