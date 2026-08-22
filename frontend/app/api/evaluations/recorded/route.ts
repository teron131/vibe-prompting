/** Starts judge-only evaluations from completed durable Target Run turns without invoking the Target again. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationRunSummary } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanRecordedRun(
        user.id,
        await request.json(),
      )) satisfies EvaluationRunSummary,
      { headers: NO_STORE_HEADERS, status: 202 },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
