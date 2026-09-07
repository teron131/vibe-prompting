/** Shares safe error classification across HTTP adapters while each adapter owns its response shape and headers. */

type ServerError = {
  code: string | undefined;
  message: string;
  status: number;
};

/** Preserves client-facing failures while replacing internal error messages with the adapter's safe fallback. */
export function projectServerError(error: unknown, fallback: string): ServerError {
  if (error instanceof SyntaxError) {
    return {
      code: undefined,
      message: "Request body must contain valid JSON.",
      status: 400,
    };
  }
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
      ? error.statusCode
      : error && typeof error === "object" && "name" in error && error.name === "ZodError"
        ? 400
        : 500;
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return {
    code,
    message: status < 500 && error instanceof Error ? error.message : fallback,
    status,
  };
}
