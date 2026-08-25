/** Exposes saved prompt creation and active-revision listing to browser workspace surfaces. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { PromptEditorSnapshot, PromptsResponse } from "@/contracts/prompts";
import { NO_STORE_HEADERS } from "@/server/errors";
import { requireRecord, requireString, requireText } from "@/server/request";

import { promptErrorResponse } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    const prompts = await services.prompts.listPromptSummaries();
    return Response.json({ prompts } satisfies PromptsResponse, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return promptErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const record = requireRecord(await request.json());
    const title = requireText(record.title, "Prompt title");
    const markdown = requireString(record.markdown, "Prompt Markdown");
    const services = await getApplicationServices();
    const prompt = await services.prompts.createPrompt(user.id, { markdown, title });
    return Response.json(prompt satisfies PromptEditorSnapshot, {
      headers: NO_STORE_HEADERS,
      status: 201,
    });
  } catch (error) {
    return promptErrorResponse(error);
  }
}
