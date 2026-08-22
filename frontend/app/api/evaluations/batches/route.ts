/** Starts a server-expanded evaluation matrix while keeping batch recipe knowledge out of browser execution. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationBatchStart, EvaluationBatchStatus } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const runIds = new URL(request.url).searchParams.getAll("runId");
    if (runIds.length === 0 || runIds.length > 200) {
      const error = new Error("Provide between 1 and 200 runId values.") as Error & {
        statusCode: number;
      };
      error.statusCode = 400;
      throw error;
    }
    runIds.forEach((runId) => requireUuid(runId, "runId"));
    const services = await getApplicationServices();
    return Response.json(
      {
        runs: await Promise.all(
          runIds.map((runId) => services.evaluations.getRunSummary(user.id, runId)),
        ),
      } satisfies EvaluationBatchStatus,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanBatch(
        user.id,
        await request.json(),
      )) satisfies EvaluationBatchStart,
      { headers: NO_STORE_HEADERS, status: 202 },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
