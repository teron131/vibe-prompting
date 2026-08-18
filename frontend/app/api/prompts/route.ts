/** Exposes saved prompt creation and current-revision listing to browser workspace surfaces. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";

import { promptErrorResponse, requireRecord, requireString, requireText } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET() {
  try {
    const services = await getApplicationServices();
    return Response.json(
      { prompts: await services.prompts.listPrompts() } satisfies PromptsResponse,
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return Response.json({ error: "Saved prompts could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const record = requireRecord(await request.json());
    const title = requireText(record.title, "Prompt title");
    const markdown = requireString(record.markdown, "Prompt Markdown");
    const services = await getApplicationServices();
    return Response.json(
      (await services.prompts.createPrompt({ markdown, title })) satisfies PromptSummary,
      {
        headers: NO_STORE_HEADERS,
        status: 201,
      },
    );
  } catch (error) {
    return promptErrorResponse(error);
  }
}
