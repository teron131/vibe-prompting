/** Owns reusable validation primitives for server route inputs. */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RequestValidationError extends Error {
  readonly statusCode = 400;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("Request body must contain a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new RequestValidationError(`${label} must be text.`);
  return value;
}

export function requireText(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) throw new RequestValidationError(`${label} is required.`);
  return text;
}

export function requireUuid(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!UUID_PATTERN.test(text)) throw new RequestValidationError(`${label} must be a UUID.`);
  return text;
}
