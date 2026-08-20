/** Exposes allowlisted evaluation counts, grouped counts, keyword counts, and numeric averages without accepting arbitrary SQL. */

import { getApplicationServices } from "vibe-prompting/server";

import type { EvaluationQueryResponse } from "@/contracts/evaluation-workspace";

import { evaluationErrorResponse } from "../request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    const response = await services.evaluationResults.query(await request.json());
    return Response.json(response satisfies EvaluationQueryResponse, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return evaluationErrorResponse(error);
  }
}
