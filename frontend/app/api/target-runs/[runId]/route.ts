/** Reads, continues, and stops one durable Target Run while active events remain process-local and replayable. */

import { getApplicationServices } from "vibe-prompting/server";

import type { StopTargetRunResponse, TargetRun, TargetRunResponse } from "@/contracts/target-runs";

import { requireUuid, targetRunErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.getRunResponse(runId)) satisfies TargetRunResponse,
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return targetRunErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.continueRun(runId, await request.json())) satisfies TargetRun,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return targetRunErrorResponse(error);
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const runId = requireUuid((await context.params).runId, "Target Run ID");
    const services = await getApplicationServices();
    return Response.json(
      { stopped: services.targetRuns.stop(runId) } satisfies StopTargetRunResponse,
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return targetRunErrorResponse(error);
  }
}
