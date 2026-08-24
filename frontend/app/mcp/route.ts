/** Embeds the authenticated FastMCP HTTP transport in the deployed Next.js backend process. */

import type { NextRequest } from "next/server";
import { getMcpServer } from "vibe-prompting/mcp";

import { authenticateMcpRequest } from "@/auth/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleMcpRequest(request: NextRequest): Promise<Response> {
  const publicUrl = configuredPublicUrl();
  if (!publicUrl) {
    return Response.json({ error: "MCP public origin is not configured." }, { status: 503 });
  }
  if (!hasTrustedAuthority(request, publicUrl)) {
    return Response.json({ error: "Untrusted MCP request host or origin." }, { status: 403 });
  }
  const authInfo = await authenticateMcpRequest(request);
  if (authInfo instanceof Response) return authInfo;
  const server = await getMcpServer();
  return server.fetch(request, { authInfo });
}

function configuredPublicUrl(): URL | null {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!configuredBaseUrl) return null;
  try {
    const url = new URL(configuredBaseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hasTrustedAuthority(request: NextRequest, publicUrl: URL): boolean {
  const host = request.headers.get("host");
  if (!host || host.toLowerCase() !== publicUrl.host.toLowerCase()) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === publicUrl.origin;
  } catch {
    return false;
  }
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
