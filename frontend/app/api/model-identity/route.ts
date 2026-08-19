/** Resolves a persisted model ID through the same Models.dev identity path used by configured models. */

import { getModelIdentity } from "vibe-prompting/server";

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get("modelId")?.trim();
  if (!modelId || modelId.length > 200) {
    return Response.json({ error: "A valid modelId is required." }, { status: 400 });
  }
  return Response.json(await getModelIdentity(modelId), {
    headers: { "Cache-Control": "no-store" },
  });
}
