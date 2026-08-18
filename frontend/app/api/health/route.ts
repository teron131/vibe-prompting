/** Provides the lightweight process health probe used by the deployment platform. */

export function GET() {
  return new Response("ok", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
