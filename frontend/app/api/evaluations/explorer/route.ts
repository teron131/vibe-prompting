/** Uses the configured helper model to translate one question before executing the validated evaluation result service. */

import { exploreEvaluations, getApplicationServices } from "vibe-prompting/server";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: unknown };
    const services = await getApplicationServices();
    return Response.json(await exploreEvaluations(services.evaluationResults, body.question), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
