/** Exposes browser-safe application settings and accepts complete model catalogues plus provider override patches. */

import { type ApplicationSettings, getApplicationServices } from "vibe-prompting/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET() {
  try {
    const services = await getApplicationServices();
    return Response.json(services.settings.get() satisfies ApplicationSettings, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const services = await getApplicationServices();
    const settings = await services.settings.update(await request.json());
    return Response.json(settings satisfies ApplicationSettings, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "Request body must contain valid JSON." },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  const status =
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : error && typeof error === "object" && "name" in error && error.name === "ZodError"
        ? 400
        : 500;
  return Response.json(
    {
      error:
        status < 500 && error instanceof Error
          ? error.message
          : "The server could not complete the request.",
    },
    { headers: NO_STORE_HEADERS, status },
  );
}
