/** Projects an exact evaluation execution manifest before any durable runs are started. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationBatchPreview } from "@/contracts/evaluations";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      (await services.evaluations.previewBatch(
        await request.json(),
      )) satisfies EvaluationBatchPreview,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}
