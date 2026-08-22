/** Enforces active application sessions across workspace pages and APIs while preserving public authentication and health routes. */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRequestSessionUser } from "@/auth/session";

const PUBLIC_PATHS = ["/api/auth", "/api/health", "/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const user = await getRequestSessionUser(request);
  if (!user) return unauthorized(request);
  if (user.membershipStatus !== "active") {
    if (pathname === "/access") return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Invitation activation is required." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/access", request.url));
  }
  if (pathname === "/access") return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
