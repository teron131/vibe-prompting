/** Adapts bounded evaluation filters to typed aggregates, switchable facets, and chronological totals. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { EvaluationAnalyticsResponse } from "@/contracts/evaluation-workspace";
import { serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireActiveSessionUser();
    const params = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    const response = await services.evaluationResults.getAnalytics({
      criterion: optional(params, "criterion"),
      dataType: optional(params, "dataType"),
      from: optional(params, "from"),
      judgeModels: repeated(params, "judgeModel"),
      promptId: optional(params, "promptId"),
      promptRevisionId: optional(params, "promptRevisionId"),
      runId: optional(params, "runId"),
      search: optional(params, "search") ?? optional(params, "q"),
      searchField: optional(params, "searchField"),
      status: optional(params, "status"),
      targetModels: repeated(params, "targetModel"),
      to: optional(params, "to"),
    });
    return Response.json(response satisfies EvaluationAnalyticsResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, "Evaluation storage failed.");
  }
}

function optional(params: URLSearchParams, name: string): string | undefined {
  return params.get(name)?.trim() || undefined;
}

function repeated(params: URLSearchParams, name: string): string[] | undefined {
  const values = params
    .getAll(name)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
