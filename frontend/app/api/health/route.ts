/** Provides the lightweight process health probe for local diagnostics. */

export function GET() {
  return new Response("ok", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
