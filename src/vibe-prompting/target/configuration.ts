/** Owns validation for the persisted configuration applied when a prompt is executed as a Target. */

import { z } from "zod";

export const targetConfigurationSchema = z
  .object({
    maxOutputTokens: z.number().int().positive().max(100_000).optional(),
    maxSteps: z.number().int().min(1).max(20).optional(),
    tools: z
      .array(z.enum(["web-search"]))
      .max(1)
      .optional(),
  })
  .strict();

export type TargetConfiguration = z.infer<typeof targetConfigurationSchema>;
