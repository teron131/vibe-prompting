/** Reloads one exact immutable evaluation report together with its fingerprint-gated Boolean trend. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationRunResponse } from "@/contracts/evaluations";

import { evaluationErrorResponse, requireUuid } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    requireUuid(runId, "Evaluation run ID");
    const services = await getApplicationServices();
    const [run, trend] = await Promise.all([
      services.evaluations.getRun(runId),
      services.evaluations.getCompatibleBooleanTrend(runId),
    ]);
    return Response.json({ run, trend } satisfies EvaluationRunResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
