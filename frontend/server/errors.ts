/** Normalizes domain and validation failures into safe server-route error projections. */

import { projectServerError } from "vibe-prompting/server";

export const NO_STORE_HEADERS = { "cache-control": "no-store" };

export function serverErrorResponse(error: unknown, fallback: string): Response {
  const projected = projectServerError(error, fallback);
  return Response.json(
    { code: projected.code, error: projected.message },
    { headers: NO_STORE_HEADERS, status: projected.status },
  );
}
