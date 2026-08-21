/** Centralizes Target Run route identifier validation and safe browser error projection. */

const HEADERS = { "cache-control": "no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: string | null, label: string): string {
  if (!value || !UUID_PATTERN.test(value)) {
    const error = new Error(`${label} must be a UUID.`) as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function targetRunErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: "Request body must contain valid JSON." },
      { headers: HEADERS, status: 400 },
    );
  }
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message =
    status < 500 && error instanceof Error ? error.message : "Target Run storage failed.";
  return Response.json({ error: message }, { headers: HEADERS, status });
}
