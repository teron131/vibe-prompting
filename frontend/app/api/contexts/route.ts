/** Exposes saved context creation and active-revision listing to browser workspace surfaces. */

import { getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ContextEditorSnapshot, ContextsResponse } from "@/contracts/contexts";
import { NO_STORE_HEADERS } from "@/server/errors";
import { requireRecord, requireString, requireText } from "@/server/request";

import { contextErrorResponse } from "./request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    const contexts = await services.contexts.listContextSummaries();
    return Response.json({ contexts } satisfies ContextsResponse, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return contextErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const record = requireRecord(await request.json());
    const title = requireText(record.title, "Context title");
    const markdown = requireString(record.markdown, "Context Markdown");
    const services = await getApplicationServices();
    const context = await services.contexts.createContext(user.id, { markdown, title });
    return Response.json(context satisfies ContextEditorSnapshot, {
      headers: NO_STORE_HEADERS,
      status: 201,
    });
  } catch (error) {
    return contextErrorResponse(error);
  }
}
