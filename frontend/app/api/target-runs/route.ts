/** Starts prompt-revision-pinned Target Runs and lists their prompt-scoped durable history outside general chat. */

import { getApplicationServices } from "vibe-prompting/server";

import type { TargetRun, TargetRunsResponse } from "@/contracts/target-runs";

import { requireUuid, targetRunErrorResponse } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const promptId = requireUuid(new URL(request.url).searchParams.get("promptId"), "Prompt ID");
    const services = await getApplicationServices();
    return Response.json(
      { runs: await services.targetRuns.listRuns(promptId) } satisfies TargetRunsResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return targetRunErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.startHumanRun(await request.json())) satisfies TargetRun,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return targetRunErrorResponse(error);
  }
}
