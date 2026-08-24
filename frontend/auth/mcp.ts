/** Authenticates the deployed MCP bearer token and binds it to one active application member. */

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

import type { McpAuthInfo } from "vibe-prompting/mcp";
import { getApplicationServices } from "vibe-prompting/server";

const MCP_CLIENT_ID = "vibe-prompting-mcp";

export async function authenticateMcpRequest(request: Request): Promise<McpAuthInfo | Response> {
  const configuredToken = process.env.MCP_ACCESS_TOKEN?.trim();
  const actorUserId = process.env.MCP_ACTOR_USER_ID?.trim();
  if (!configuredToken || !actorUserId) {
    return Response.json({ error: "MCP is not configured." }, { status: 503 });
  }
  const suppliedToken = readBearerToken(request.headers.get("authorization"));
  if (!suppliedToken || !tokensMatch(suppliedToken, configuredToken)) return unauthorized();
  try {
    const services = await getApplicationServices();
    const actor = await services.auth.requireActiveUser(actorUserId);
    return {
      clientId: MCP_CLIENT_ID,
      token: suppliedToken,
      scopes: ["workspace:read", "workspace:write"],
      extra: { actorUserId: actor.id },
    };
  } catch {
    return Response.json({ error: "MCP authentication is unavailable." }, { status: 503 });
  }
}

function readBearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer[\t ]+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

function tokensMatch(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function unauthorized(): Response {
  return Response.json(
    { error: "MCP bearer authentication required." },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="vibe-prompting-mcp"' },
    },
  );
}
