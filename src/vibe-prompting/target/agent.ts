/** Wraps the application's vanilla Vercel AI SDK agent as a repeatable Target without owning model configuration. */

import type { LanguageModel, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";

import type { Target } from "./api.ts";

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

export function createAiSdkTarget(input: {
  configuration: TargetConfiguration;
  instructions: string;
  model: LanguageModel;
  modelId: string;
  profileId: string;
  tools?: ToolSet;
}): Target<string, string> {
  const agent = new ToolLoopAgent({
    id: input.profileId,
    instructions: input.instructions,
    maxOutputTokens: input.configuration.maxOutputTokens,
    model: input.model,
    stopWhen: input.configuration.maxSteps ? stepCountIs(input.configuration.maxSteps) : undefined,
    tools: input.tools,
  });
  return {
    model: input.modelId,
    async invoke(message) {
      const result = await agent.generate({ prompt: message });
      return result.text;
    },
  };
}
