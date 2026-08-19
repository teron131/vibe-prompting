/** Starts detached prompt-bound browser evaluations and lists their durable application-facing attempts. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";

import { evaluationErrorResponse, requireUuid } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const promptId = params.get("promptId") ?? undefined;
    if (promptId) requireUuid(promptId, "Prompt ID");
    const services = await getApplicationServices();
    return Response.json(
      { runs: await services.evaluations.listRuns({ promptId }) } satisfies EvaluationRunsResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanRun(body)) satisfies EvaluationRunSummary,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
