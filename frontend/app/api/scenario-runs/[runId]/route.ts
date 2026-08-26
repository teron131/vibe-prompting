/** Reads and stops one durable Scenario Run together with its linked Target trace and evaluations. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ScenarioRunResponse } from "@/contracts/scenario-runs";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const runId = requireUuid((await context.params).runId, "Scenario Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.scenarios.getRunResponse(user.id, runId)) satisfies ScenarioRunResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Scenario Run storage failed.");
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const runId = requireUuid((await context.params).runId, "Scenario Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.scenarios.cancel(user.id, runId)) satisfies ScenarioRunResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Scenario Run storage failed.");
  }
}
