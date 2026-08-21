/** Exposes saved prompt creation and active-revision listing to browser workspace surfaces. */

import { getApplicationServices } from "vibe-prompting/server";

import type { PromptEditorSnapshot, PromptsResponse } from "@/contracts/prompts";

import { promptErrorResponse, requireRecord, requireString, requireText } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET() {
  try {
    const services = await getApplicationServices();
    const prompts = (await services.prompts.listPrompts()).map(
      ({ markdown: _markdown, ...prompt }) => prompt,
    );
    return Response.json({ prompts } satisfies PromptsResponse, { headers: NO_STORE_HEADERS });
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
    const prompt = await services.prompts.createPrompt({ markdown, title });
    return Response.json(prompt satisfies PromptEditorSnapshot, {
      headers: NO_STORE_HEADERS,
      status: 201,
    });
  } catch (error) {
    return promptErrorResponse(error);
  }
}
