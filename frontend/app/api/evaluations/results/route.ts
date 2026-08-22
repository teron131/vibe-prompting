/** Adapts bounded result filters and opaque cursors to paginated results with switchable self-excluding facets. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationResultsResponse } from "@/contracts/evaluation-workspace";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    const response = await services.evaluationResults.listResults({
      criterion: optional(params, "criterion"),
      cursor: optional(params, "cursor"),
      dataType: optional(params, "dataType"),
      from: optional(params, "from"),
      judgeModelIds: repeated(params, "judgeModelId"),
      limit: optional(params, "limit"),
      promptId: optional(params, "promptId"),
      promptRevisionId: optional(params, "promptRevisionId"),
      runId: optional(params, "runId"),
      search: optional(params, "search") ?? optional(params, "q"),
      searchField: optional(params, "searchField"),
      status: optional(params, "status"),
      targetModelIds: repeated(params, "targetModelId"),
      to: optional(params, "to"),
    });
    return Response.json(response satisfies EvaluationResultsResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
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
