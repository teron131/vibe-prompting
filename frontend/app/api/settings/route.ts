/** Exposes browser-safe application settings and accepts complete model catalogues plus provider override patches. */

import { type ApplicationSettings, getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import { NO_STORE_HEADERS, serverErrorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(services.settings.get() satisfies ApplicationSettings, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return serverErrorResponse(error, "The server could not complete the request.");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    const settings = await services.settings.update(user.id, await request.json());
    return Response.json(settings satisfies ApplicationSettings, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return serverErrorResponse(error, "The server could not complete the request.");
  }
}
