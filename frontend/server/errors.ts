/** Normalizes domain and validation failures into safe server-route error projections. */

export const NO_STORE_HEADERS = { "cache-control": "no-store" };

type ServerError = {
  code: string | undefined;
  message: string;
  status: number;
};

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
    typeof error.statusCode === "number"
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

export function serverErrorResponse(error: unknown, fallback: string): Response {
  const projected = projectServerError(error, fallback);
  return Response.json(
    { code: projected.code, error: projected.message },
    { headers: NO_STORE_HEADERS, status: projected.status },
  );
}
