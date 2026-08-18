/** Projects cursor-paginated prompt-bound chat history for the workspace sidebar. */

import { getApplicationServices } from "vibe-prompting/server";

import type { ChatPage } from "@/contracts/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    const payload = await services.conversations.listChats({
      cursor: params.get("cursor") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });
    return Response.json(payload satisfies ChatPage, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat history could not be loaded." },
      { status: 400 },
    );
  }
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("Chat history limit must be an integer from 1 to 100.");
  }
  return parsed;
}
