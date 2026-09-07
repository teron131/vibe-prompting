/** Resolves exact prompt and profile revisions into an executable definition without opening model or tool connections. */

import { createHash } from "node:crypto";

import type { PromptSystem } from "../prompt-system/index.ts";
import type { TargetProfile, TargetProfiles } from "./profiles.ts";

export type TargetPinInput = {
  actorUserId: string;
  promptId: string;
  promptRevisionId: string;
  targetProfileId?: string;
  targetProfileRevisionId?: string;
  targetModel: string;
  reasoningEffort?: "high" | "low" | "medium" | "xhigh";
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

/** Pins historical revisions when supplied, otherwise resolves the current profile or persists its default. */
export async function resolveTargetDefinition(
  prompts: PromptSystem,
  profiles: TargetProfiles,
  input: TargetPinInput,
): Promise<PinnedTargetDefinition> {
  const [profile, prompt] = await Promise.all([
    input.targetProfileId && input.targetProfileRevisionId
      ? profiles.getRevision(input.promptId, input.targetProfileId, input.targetProfileRevisionId)
      : profiles.ensureProfileForPrompt(input.actorUserId, input.promptId),
    prompts.getRevision(input.promptId, input.promptRevisionId),
  ]);
  const effectiveInstructions = [profile.instructions, prompt.markdown]
    .filter(Boolean)
    .join("\n\n");
  const effectiveInstructionsHash = createHash("sha256")
    .update(effectiveInstructions)
    .digest("hex");
  return {
    promptId: input.promptId,
    promptRevisionId: input.promptRevisionId,
    targetModel: input.targetModel,
    reasoningEffort: input.reasoningEffort,
    profile,
    effectiveInstructions,
    effectiveInstructionsHash,
  };
}
