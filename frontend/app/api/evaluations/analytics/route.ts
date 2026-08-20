/** Adapts bounded evaluation filters to database-side typed aggregates, facets, and chronological totals. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationAnalyticsResponse } from "@/contracts/evaluation-workspace";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    const response = await services.evaluationResults.getAnalytics({
      criterion: optional(params, "criterion"),
      dataType: optional(params, "dataType"),
      from: optional(params, "from"),
      judgeModelId: optional(params, "judgeModelId"),
      promptId: optional(params, "promptId"),
      promptRevisionId: optional(params, "promptRevisionId"),
      runId: optional(params, "runId"),
      search: optional(params, "search") ?? optional(params, "q"),
      searchField: optional(params, "searchField"),
      status: optional(params, "status"),
      targetModelId: optional(params, "targetModelId"),
      to: optional(params, "to"),
    });
    return Response.json(response satisfies EvaluationAnalyticsResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}

function optional(params: URLSearchParams, name: string): string | undefined {
  return params.get(name)?.trim() || undefined;
}
