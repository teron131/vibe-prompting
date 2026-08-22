/** Resolves revocable application sessions from server cookies and request-bound cookie stores. */

import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getApplicationServices, type SessionUser } from "vibe-prompting/server";

export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-vibe-session" : "vibe-session";
}

export function sessionCookieOptions(expires: Date) {
  return {
    expires,
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(sessionCookieName())?.value);
}

export async function getRequestSessionUser(request: NextRequest): Promise<SessionUser | null> {
  return getSessionUser(request.cookies.get(sessionCookieName())?.value);
}

export async function requireActiveSessionUser(): Promise<SessionUser> {
  const user = await getCurrentSessionUser();
  if (!user) throw new SessionAccessError("Authentication required.", 401);
  if (user.membershipStatus !== "active") {
    throw new SessionAccessError("Invitation activation is required.", 403);
  }
  return user;
}

export class SessionAccessError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SessionAccessError";
    this.statusCode = statusCode;
  }
}

async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const services = await getApplicationServices();
  return services.auth.getSessionUser(token);
}
