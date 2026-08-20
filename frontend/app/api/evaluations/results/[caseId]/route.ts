/** Returns one evaluation case with its exact run provenance and complete judge-attributed score evidence. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationResultResponse } from "@/contracts/evaluation-workspace";

import { evaluationErrorResponse, requireUuid } from "../../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    requireUuid(caseId, "Evaluation case ID");
    const services = await getApplicationServices();
    const response = {
      item: await services.evaluationResults.getResult(caseId),
      provenance: {
        generatedAt: new Date().toISOString(),
        source: "evaluation_storage" as const,
        syntheticExamplesIncluded: true,
      },
    };
    return Response.json(response satisfies EvaluationResultResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
