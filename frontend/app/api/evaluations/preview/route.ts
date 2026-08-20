/** Projects an exact evaluation execution manifest before any durable runs are started. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationBatchPreview } from "@/contracts/evaluations";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.previewBatch(
        await request.json(),
      )) satisfies EvaluationBatchPreview,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
