/** Starts judge-only evaluations from completed durable Target Run turns without invoking the Target again. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationRunSummary } from "@/contracts/evaluations";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanRecordedRun(
        await request.json(),
      )) satisfies EvaluationRunSummary,
      { headers: NO_STORE_HEADERS, status: 202 },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
