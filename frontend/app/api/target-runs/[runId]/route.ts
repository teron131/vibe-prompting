/** Reads, continues, and stops one durable Target Run while active events remain process-local and replayable. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { StopTargetRunResponse, TargetRun, TargetRunResponse } from "@/contracts/target-runs";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.getRunResponse(user.id, runId)) satisfies TargetRunResponse,
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return serverErrorResponse(error, "Target Run storage failed.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.continueRun(
        user.id,
        runId,
        await request.json(),
      )) satisfies TargetRun,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return serverErrorResponse(error, "Target Run storage failed.");
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      { stopped: await services.targetRuns.stop(user.id, runId) } satisfies StopTargetRunResponse,
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return serverErrorResponse(error, "Target Run storage failed.");
  }
}
