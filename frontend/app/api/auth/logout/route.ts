/** Revokes the current opaque application session and returns the browser to sign-in. */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getApplicationServices } from "vibe-prompting/server";

import { sessionCookieName, sessionCookieOptions } from "@/auth/session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (token) {
    const services = await getApplicationServices();
    await services.auth.deleteSession(token);
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(sessionCookieName(), "", sessionCookieOptions(new Date(0)));
  return response;
}
