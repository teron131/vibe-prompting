/** Exposes ranked hybrid saved-prompt search to both browser workspace surfaces. */

import { EmbeddingError, getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { PromptSearchResponse } from "@/contracts/prompts";
import { NO_STORE_HEADERS } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireActiveSessionUser();
  const query = new URL(request.url).searchParams.get("q")?.replace(/\s+/g, " ").trim() ?? "";
  if (query.length < 2 || query.length > 200) {
    return Response.json(
      { error: "Search query must be between 2 and 200 characters." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }

  try {
    const services = await getApplicationServices();
    const prompts = (await services.prompts.searchPrompts(query)).map(
      ({ markdown: _markdown, ...prompt }) => prompt,
    );
    return Response.json({ prompts } satisfies PromptSearchResponse, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: error.statusCode },
      );
    }
    return Response.json(
      { error: "Saved prompts could not be searched." },
      { headers: NO_STORE_HEADERS, status: 500 },
    );
  }
}
