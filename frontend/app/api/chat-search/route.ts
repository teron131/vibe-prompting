/** Exposes shared hybrid search over chat titles and persisted user or assistant text. */

import { EmbeddingError, getApplicationServices } from "vibe-prompting/server";

import type { ChatSearchResponse } from "@/contracts/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query)
    return Response.json({ chats: [] } satisfies ChatSearchResponse, {
      headers: { "cache-control": "no-store" },
    });
  try {
    const services = await getApplicationServices();
    const payload = {
      chats: await services.conversations.searchChats(query),
    } satisfies ChatSearchResponse;
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    return Response.json({ error: "Chat search failed." }, { status: 500 });
  }
}
