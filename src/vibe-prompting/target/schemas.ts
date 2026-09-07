/** Owns the provider-neutral Target interface, persisted runtime configuration validation, and activity shapes shared by execution and replay. */

import { z } from "zod";

export type Target<INPUT = unknown, OUTPUT = unknown> = {
  readonly model: string;
  invoke(input: INPUT): PromiseLike<OUTPUT>;
};

export const targetSchema = z.custom<Target>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "model" in value &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model === value.model.trim() &&
    "invoke" in value &&
    typeof value.invoke === "function",
  "Target must expose a non-empty model ID and an invoke function.",
);

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

export type TargetActivityPart =
  | { summary: string; type: "reasoning" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "failed" | "running";
      summary?: string;
      type: "tool";
    };

export type TargetRuntimeEvent =
  | { delta: string; type: "text-delta" }
  | { type: "reasoning-start" }
  | { delta: string; type: "reasoning-delta" }
  | TargetActivityPart;

export type TargetProfile = {
  configuration: TargetConfiguration;
  id: string;
  instructions: string;
  name: string;
  revisionId: string;
};

export type CreateProfileInput = {
  configuration: TargetConfiguration;
  instructions: string;
  name: string;
  promptId: string;
};

export type ProfileRevisionInput = {
  configuration: TargetConfiguration;
  expectedRevisionId: string;
  instructions: string;
  profileId: string;
};

export type TargetPinInput = {
  actorUserId: string;
  promptId: string;
  promptRevisionId: string;
  targetProfileId?: string;
  targetProfileRevisionId?: string;
  targetModel: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
};

export type PinnedTargetDefinition = {
  promptId: string;
  promptRevisionId: string;
  targetModel: string;
  reasoningEffort?: TargetPinInput["reasoningEffort"];
  profile: TargetProfile;
  effectiveInstructions: string;
  effectiveInstructionsHash: string;
};
