/** Starts prompt-revision-pinned Target Runs and lists their prompt-scoped durable history outside general chat. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { TargetRun, TargetRunsResponse } from "@/contracts/target-runs";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";
import { requireUuid } from "@/server/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const promptId = requireUuid(new URL(request.url).searchParams.get("promptId"), "Prompt ID");
    const services = await getApplicationServices();
    return Response.json(
      { runs: await services.targetRuns.listRuns(user.id, promptId) } satisfies TargetRunsResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return serverErrorResponse(error, "Target Run storage failed.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      (await services.targetRuns.startHumanRun(user.id, await request.json())) satisfies TargetRun,
      {
        headers: NO_STORE_HEADERS,
        status: 202,
      },
    );
  } catch (error) {
    return serverErrorResponse(error, "Target Run storage failed.");
  }
}
