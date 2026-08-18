/** Protects every deployed browser and API route with one small-team shared credential. */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const username = process.env.APP_USERNAME?.trim();
  const password = process.env.APP_PASSWORD;
  if (!username || !password) {
    return new Response("Deployment authentication is not configured.", { status: 503 });
  }

  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  if (request.headers.get("authorization") !== expected) {
    return new Response("Authentication required.", {
      headers: { "www-authenticate": 'Basic realm="Vibe Prompting", charset="UTF-8"' },
      status: 401,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/health$).*)"],
};
