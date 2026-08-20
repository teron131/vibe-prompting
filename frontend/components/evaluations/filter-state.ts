/** Owns evaluation workspace filter parsing and URL serialization for results and analytics screens. */

import type {
  EvaluationDataType,
  EvaluationWorkspaceFilters,
} from "@/contracts/evaluation-workspace";
import type { EvaluationRunStatus } from "@/contracts/evaluations";

export function parseEvaluationFilters(search: string): EvaluationWorkspaceFilters {
  const params = new URLSearchParams(search);
  return {
    criterion: params.get("criterion") ?? undefined,
    dataType: (params.get("dataType") as EvaluationDataType | null) ?? undefined,
    from: params.get("from") ?? undefined,
    judgeModelId: params.get("judgeModelId") ?? undefined,
    promptId: params.get("promptId") ?? undefined,
    promptRevisionId: params.get("promptRevisionId") ?? undefined,
    runId: params.get("runId") ?? undefined,
    search: params.get("search") ?? undefined,
    searchField:
      (params.get("searchField") as EvaluationWorkspaceFilters["searchField"] | null) ?? undefined,
    status: (params.get("status") as EvaluationRunStatus | null) ?? undefined,
    targetModelId: params.get("targetModelId") ?? undefined,
    to: params.get("to") ?? undefined,
  };
}

export function evaluationFilterParams(filters: EvaluationWorkspaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params;
}

export function analyticsFilterParams(filters: EvaluationWorkspaceFilters): URLSearchParams {
  const params = evaluationFilterParams(filters);
  const from = params.get("from");
  const to = params.get("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) params.set("from", `${from}T00:00:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) params.set("to", `${to}T23:59:59.999`);
  return params;
}
