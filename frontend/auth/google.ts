/** Owns Google OpenID Connect discovery and the authorization-code flow's deployment URL boundary. */

import "server-only";
import type { NextRequest } from "next/server";
import * as oidc from "openid-client";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
const OAUTH_COOKIE_DURATION_SECONDS = 10 * 60;
const RETURN_PATH_ORIGIN = "https://vibe-prompting.invalid";

export const oauthCookieNames = {
  nonce: "vibe-oauth-nonce",
  returnPath: "vibe-oauth-return",
  state: "vibe-oauth-state",
  verifier: "vibe-oauth-verifier",
} as const;

export const oauthCookieOptions = {
  httpOnly: true,
  maxAge: OAUTH_COOKIE_DURATION_SECONDS,
  path: "/api/auth/google/callback",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

const sharedState = globalThis as typeof globalThis & {
  googleOpenIdConfiguration?: Promise<oidc.Configuration>;
};

export function getGoogleOpenIdConfiguration(): Promise<oidc.Configuration> {
  if (!sharedState.googleOpenIdConfiguration) {
    const clientId = requireEnvironment("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = requireEnvironment("GOOGLE_OAUTH_CLIENT_SECRET");
    sharedState.googleOpenIdConfiguration = oidc
      .discovery(GOOGLE_ISSUER, clientId, clientSecret)
      .catch((error: unknown) => {
        delete sharedState.googleOpenIdConfiguration;
        throw error;
      });
  }
  return sharedState.googleOpenIdConfiguration;
}

export function googleCallbackUrl(request: NextRequest): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!configuredBaseUrl && process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL is required for deployed Google authentication.");
  }
  const baseUrl = configuredBaseUrl ? new URL(configuredBaseUrl) : request.nextUrl;
  return new URL("/api/auth/google/callback", baseUrl.origin).toString();
}

export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  try {
    const url = new URL(value, RETURN_PATH_ORIGIN);
    return url.origin === RETURN_PATH_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Google authentication.`);
  return value;
}
