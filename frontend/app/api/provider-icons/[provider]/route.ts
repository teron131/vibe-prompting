/** Serves cache-resolved provider icons with browser and CDN freshness policy. */

import { resolveProviderIcon } from "@/server/provider-icons";

const CACHE_SECONDS = 24 * 60 * 60;
const ICON_CACHE_CONTROL = `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${7 * CACHE_SECONDS}`;

export const revalidate = 86400;

export async function GET(_request: Request, context: { params: Promise<{ provider: string }> }) {
  const icon = await resolveProviderIcon((await context.params).provider);
  if (!icon) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
  return new Response(icon.body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "CDN-Cache-Control": ICON_CACHE_CONTROL,
      "Content-Type": icon.contentType,
      "Vercel-CDN-Cache-Control": ICON_CACHE_CONTROL,
    },
  });
}
