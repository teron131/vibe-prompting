/** Composes profile persistence, revision pinning, and executable runtimes behind the public Target System API. */

import { createHash } from "node:crypto";

import { type ModelContext, standaloneModelContext } from "../clients/llm/context.ts";
import type { Database } from "../database/index.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import { TargetProfiles } from "./profiles.ts";
import { openTargetRuntime, type PinnedTarget } from "./runtime.ts";
import type {
  CreateProfileInput,
  PinnedTargetDefinition,
  ProfileRevisionInput,
  TargetPinInput,
  TargetProfile,
} from "./schemas.ts";

/** Keeps the public Target operations stable while sharing one pinning recipe across durable workflows. */
export class TargetSystem {
  readonly #models: ModelContext;
  readonly #profiles: TargetProfiles;
  readonly #prompts: PromptSystem;

  constructor(
    database: Database,
    prompts: PromptSystem,
    models: ModelContext = standaloneModelContext,
  ) {
    this.#models = models;
    this.#profiles = new TargetProfiles(database, prompts);
    this.#prompts = prompts;
  }

  /** Creates a revisioned profile for an existing prompt. */
  async createProfile(actorUserId: string, input: CreateProfileInput): Promise<TargetProfile> {
    return this.#profiles.createProfile(actorUserId, input);
  }

  async getProfileForPrompt(promptId: string): Promise<TargetProfile> {
    return this.#profiles.getProfileForPrompt(promptId);
  }

  /** Persists a default profile only when the prompt has no explicit profile. */
  async ensureProfileForPrompt(actorUserId: string, promptId: string): Promise<TargetProfile> {
    return this.#profiles.ensureProfileForPrompt(actorUserId, promptId);
  }

  /** Advances a profile only when its expected revision still owns the head. */
  async appendProfileRevision(
    actorUserId: string,
    input: ProfileRevisionInput,
  ): Promise<TargetProfile> {
    return this.#profiles.appendProfileRevision(actorUserId, input);
  }

  /** Pins exact historical revisions when supplied, otherwise resolves or creates the current profile without opening provider connections. */
  async resolveDefinition(input: TargetPinInput): Promise<PinnedTargetDefinition> {
    const [profile, prompt] = await Promise.all([
      input.targetProfileId && input.targetProfileRevisionId
        ? this.#profiles.getRevision(
            input.promptId,
            input.targetProfileId,
            input.targetProfileRevisionId,
          )
        : this.#profiles.ensureProfileForPrompt(input.actorUserId, input.promptId),
      this.#prompts.getRevision(input.promptId, input.promptRevisionId),
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

  /** Opens an executable runtime from the same definition used to prepare durable evaluation records. */
  async createPinnedTarget(input: TargetPinInput): Promise<PinnedTarget> {
    return openTargetRuntime(await this.resolveDefinition(input), this.#models);
  }
}
