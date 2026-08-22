/** Starts Google OpenID Connect with PKCE, state, nonce, and a bounded same-origin return path. */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";

import {
  getGoogleOpenIdConfiguration,
  googleCallbackUrl,
  oauthCookieNames,
  oauthCookieOptions,
  safeReturnPath,
} from "@/auth/google";

export async function GET(request: NextRequest) {
  try {
    const configuration = await getGoogleOpenIdConfiguration();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const nonce = oidc.randomNonce();
    const state = oidc.randomState();
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
      code_challenge: challenge,
      code_challenge_method: "S256",
      nonce,
      redirect_uri: googleCallbackUrl(request),
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(oauthCookieNames.verifier, verifier, oauthCookieOptions);
    response.cookies.set(oauthCookieNames.nonce, nonce, oauthCookieOptions);
    response.cookies.set(oauthCookieNames.state, state, oauthCookieOptions);
    response.cookies.set(
      oauthCookieNames.returnPath,
      safeReturnPath(request.nextUrl.searchParams.get("returnTo")),
      oauthCookieOptions,
    );
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth-unavailable", request.url));
  }
}
