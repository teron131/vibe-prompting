/** Authenticates browser chat commands and encodes backend-owned run events as NDJSON. */
import { type ChatRun, getApplicationServices } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import { NO_STORE_HEADERS, projectServerError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    const payload = await services.conversations.inspect(
      user.id,
      new URL(request.url).searchParams.get("id"),
    );
    return Response.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    const run = await services.conversations.send(user.id, input);
    return new Response(createNdjsonStream(run), {
      headers: {
        ...NO_STORE_HEADERS,
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-chat-id": run.chatId,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json();
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(await services.conversations.stop(user.id, input), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const input = await request.json();
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(await services.conversations.steer(user.id, input), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireActiveSessionUser();
    const services = await getApplicationServices();
    return Response.json(
      await services.conversations.delete(user.id, new URL(request.url).searchParams.get("id")),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Detaching a response only removes its listener; accepted work remains owned by the backend. */
function createNdjsonStream(run: ChatRun) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      unsubscribe = run.subscribe((event) => {
        if (finished) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        if (event.type === "finish" || event.type === "stopped" || event.type === "error") {
          finished = true;
          unsubscribe();
          controller.close();
        }
      });
      // Replayed terminal events can arrive before subscribe returns its cleanup function.
      if (finished) unsubscribe();
    },
    cancel() {
      unsubscribe();
    },
  });
}

function errorResponse(error: unknown): Response {
  const projected = projectServerError(error, "The server could not complete the request.");
  const retryAfter = readRetryAfter(error);
  return Response.json(
    { error: projected.message },
    {
      headers: {
        ...NO_STORE_HEADERS,
        ...(retryAfter === null ? {} : { "retry-after": String(retryAfter) }),
      },
      status: projected.status,
    },
  );
}

function readRetryAfter(error: unknown): number | null {
  if (
    !error ||
    typeof error !== "object" ||
    !("retryAfterSeconds" in error) ||
    typeof error.retryAfterSeconds !== "number" ||
    !Number.isInteger(error.retryAfterSeconds) ||
    error.retryAfterSeconds < 1
  ) {
    return null;
  }
  return error.retryAfterSeconds;
}
