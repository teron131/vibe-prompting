/** Composes profile persistence, revision pinning, and executable runtimes behind the public Target System API. */

import { type ModelContext, standaloneModelContext } from "../clients/llm/context.ts";
import type { Database } from "../database/index.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import {
  type PinnedTargetDefinition,
  resolveTargetDefinition,
  type TargetPinInput,
} from "./pinning.ts";
import {
  type CreateProfileInput,
  type ProfileRevisionInput,
  type TargetProfile,
  TargetProfiles,
} from "./profiles.ts";
import { openTargetRuntime, type PinnedTarget } from "./runtime.ts";

export { TargetProfileError, TargetProfileNotFoundError, type TargetProfile } from "./profiles.ts";
export type { PinnedTargetDefinition, TargetPinInput } from "./pinning.ts";
export type { PinnedTarget } from "./runtime.ts";

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

  /** Resolves the exact executable definition without connecting to model or tool providers. */
  async resolveDefinition(input: TargetPinInput): Promise<PinnedTargetDefinition> {
    return resolveTargetDefinition(this.#prompts, this.#profiles, input);
  }

  /** Opens an executable runtime from the same definition used to prepare durable evaluation records. */
  async createPinnedTarget(input: TargetPinInput): Promise<PinnedTarget> {
    return openTargetRuntime(await this.resolveDefinition(input), this.#models);
  }
}
