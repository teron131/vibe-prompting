/** Reloads one exact immutable evaluation report together with its fingerprint-gated Boolean trend. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationRunResponse } from "@/contracts/evaluations";
import { serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const { runId } = await context.params;
    requireUuid(runId, "Evaluation run ID");
    const services = await getApplicationServices();
    const [run, trend] = await Promise.all([
      services.evaluations.getRun(user.id, runId),
      services.evaluations.getCompatibleBooleanTrend(runId),
    ]);
    return Response.json({ run, trend } satisfies EvaluationRunResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireActiveSessionUser();
    const { runId } = await context.params;
    requireUuid(runId, "Evaluation run ID");
    const services = await getApplicationServices();
    return Response.json(await services.evaluations.cancel(user.id, runId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
