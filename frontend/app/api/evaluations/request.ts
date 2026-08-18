/** Centralizes evaluation-route identifier validation and safe browser error projection. */

const HEADERS = { "cache-control": "no-store" };

export function requireUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    const error = new Error(`${label} must be a UUID.`) as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
}

export function evaluationErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError)
    return Response.json({ error: "Request body must contain valid JSON." }, { status: 400 });
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message =
    status < 500 && error instanceof Error ? error.message : "Evaluation storage failed.";
  return Response.json({ error: message }, { headers: HEADERS, status });
}
