/** Serves validated Lucide icons as cacheable SVG masks for chat history. */

import { renderLucideIcon } from "../lucide-icons";

const ICON_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(_request: Request, context: RouteContext<"/api/chat-icon/[name]">) {
  const { name } = await context.params;
  if (!ICON_NAME_PATTERN.test(name)) {
    return new Response(null, { status: 404 });
  }

  const svg = await renderLucideIcon(name);
  return new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
