/** Starts a server-expanded evaluation matrix while keeping batch recipe knowledge out of browser execution. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationBatchStart, EvaluationBatchStatus } from "@/contracts/evaluations";

import { evaluationErrorResponse, requireUuid } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
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
        runs: await Promise.all(runIds.map((runId) => services.evaluations.getRunSummary(runId))),
      } satisfies EvaluationBatchStatus,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanBatch(
        await request.json(),
      )) satisfies EvaluationBatchStart,
      { headers: NO_STORE_HEADERS, status: 202 },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
