/** Centralizes prompt-route request validation and safe browser error projection without introducing a client dependency. */

const HEADERS = { "cache-control": "no-store" };

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PromptRequestError("Request body must contain a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new PromptRequestError(`${label} must be text.`);
  return value;
}

export function requireText(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) throw new PromptRequestError(`${label} is required.`);
  return text;
}

export function requireUuid(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new PromptRequestError(`${label} must be a UUID.`);
  }
  return text;
}

export class PromptRequestError extends Error {
  readonly statusCode = 400;
}

export function promptErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Request body must contain valid JSON." }, { status: 400 });
  }
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message = status < 500 && error instanceof Error ? error.message : "Prompt storage failed.";
  return Response.json({ error: message }, { headers: HEADERS, status });
}
