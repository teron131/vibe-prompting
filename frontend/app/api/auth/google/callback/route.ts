/** Completes Google OpenID Connect, stores the verified identity, and issues a revocable application session. */

import type { NextRequest, NextResponse as NextResponseType } from "next/server";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { getApplicationServices } from "vibe-prompting/server";

import {
  getGoogleOpenIdConfiguration,
  googleCallbackUrl,
  oauthCookieNames,
  oauthCookieOptions,
  safeReturnPath,
} from "@/auth/google";
import { SESSION_DURATION_SECONDS, sessionCookieName, sessionCookieOptions } from "@/auth/session";

export async function GET(request: NextRequest) {
  const verifier = request.cookies.get(oauthCookieNames.verifier)?.value;
  const nonce = request.cookies.get(oauthCookieNames.nonce)?.value;
  const state = request.cookies.get(oauthCookieNames.state)?.value;
  const returnPath = safeReturnPath(request.cookies.get(oauthCookieNames.returnPath)?.value);
  if (!verifier || !nonce || !state) return oauthFailure(request, "oauth-state");

  try {
    const configuration = await getGoogleOpenIdConfiguration();
    const tokens = await oidc.authorizationCodeGrant(
      configuration,
      new URL(request.url),
      {
        expectedNonce: nonce,
        expectedState: state,
        idTokenExpected: true,
        pkceCodeVerifier: verifier,
      },
      { redirect_uri: googleCallbackUrl(request) },
    );
    const claims = tokens.claims();
    if (
      !claims ||
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      claims.email_verified !== true
    ) {
      return oauthFailure(request, "unverified-email");
    }

    const services = await getApplicationServices();
    const user = await services.auth.upsertGoogleUser({
      email: claims.email,
      googleSubject: claims.sub,
      name: typeof claims.name === "string" ? claims.name : undefined,
    });
    const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
    const sessionToken = await services.auth.createSession(user.id, expiresAt);
    const response = NextResponse.redirect(
      new URL(user.membershipStatus === "active" ? returnPath : "/access", request.url),
    );
    response.cookies.set(sessionCookieName(), sessionToken, sessionCookieOptions(expiresAt));
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({ event: "google_oauth_callback_failed", error: safeOAuthFailure(error) }),
    );
    return oauthFailure(request, "oauth-failed");
  }
}

function oauthFailure(request: NextRequest, error: string): NextResponseType {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  clearOAuthCookies(response);
  return response;
}

function clearOAuthCookies(response: NextResponseType) {
  for (const name of Object.values(oauthCookieNames)) {
    response.cookies.set(name, "", {
      ...oauthCookieOptions,
      expires: new Date(0),
      maxAge: 0,
    });
  }
}

function safeOAuthFailure(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const detail: Record<string, string | number> = { name: error.name };
  copySafeFailureField(detail, error, "code");
  copySafeFailureField(detail, error, "status");
  if (error.cause instanceof Error) {
    detail.causeName = error.cause.name;
    copySafeFailureField(detail, error.cause, "code", "causeCode");
    copySafeFailureField(detail, error.cause, "status", "causeStatus");
  }
  return detail;
}

function copySafeFailureField(
  target: Record<string, string | number>,
  source: Error,
  sourceKey: "code" | "status",
  targetKey: string = sourceKey,
): void {
  const value = (source as unknown as Record<string, unknown>)[sourceKey];
  if (typeof value === "number") target[targetKey] = value;
  if (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(value))
    target[targetKey] = value;
}
