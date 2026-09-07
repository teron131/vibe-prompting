/** Owns HTTP identity envelopes and model references shared across capability routes; domain payloads retain their own schemas. */
import { z } from "zod";

export const modelIdSchema = z.string().trim().min(1).describe("Configured model ID.");
export const actorSchema = z.object({
  actorUserId: z.uuid().describe("Active application user initiating the mutation."),
});
export const viewerQuerySchema = z.object({ viewerUserId: z.uuid() });
