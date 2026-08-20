/** Owns browser-side JSON request decoding and consistent API error projection across frontend features. */

type ErrorFallback = string | ((status: number) => string);

export function createApiRequester(
  defaultInit: RequestInit = {},
  fallback: ErrorFallback = (status) => `Request failed with status ${status}.`,
) {
  return {
    empty(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
      return requestEmpty(input, { ...defaultInit, ...init }, fallback);
    },
    json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
      return requestJson<T>(input, { ...defaultInit, ...init }, fallback);
    },
  };
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallback: ErrorFallback = (status) => `Request failed with status ${status}.`,
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await readResponseError(response, fallback));
  return (await response.json()) as T;
}

export async function requestEmpty(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallback: ErrorFallback = (status) => `Request failed with status ${status}.`,
): Promise<void> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await readResponseError(response, fallback));
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createErrorReader(fallback: string): (error: unknown) => string {
  return (error) => errorMessage(error, fallback);
}

export async function readResponseError(
  response: Response,
  fallback: ErrorFallback = (status) => `Request failed with status ${status}.`,
): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  if (typeof payload?.error === "string") return payload.error;
  return typeof fallback === "function" ? fallback(response.status) : fallback;
}
