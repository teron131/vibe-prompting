/** Projects configured model identities from the server-only backend package into browser-safe JSON. */

import { getConfiguredModels } from "vibe-prompting/server";

import { requireActiveSessionUser } from "@/auth/session";
import type { ConfiguredModelsResponse } from "@/contracts/chat";

export async function GET() {
  await requireActiveSessionUser();
  const payload = { models: await getConfiguredModels() } satisfies ConfiguredModelsResponse;
  return Response.json(payload);
}
