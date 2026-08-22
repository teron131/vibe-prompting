/** Starts detached prompt-bound browser evaluations and lists their durable application-facing attempts. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationRunsResponse, EvaluationRunSummary } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const params = new URL(request.url).searchParams;
    const promptId = params.get("promptId") ?? undefined;
    if (promptId) requireUuid(promptId, "Prompt ID");
    const services = await getApplicationServices();
    return Response.json(
      {
        runs: await services.evaluations.listRuns(user.id, { promptId }),
      } satisfies EvaluationRunsResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const body = await request.json();
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.startHumanRun(user.id, body)) satisfies EvaluationRunSummary,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
