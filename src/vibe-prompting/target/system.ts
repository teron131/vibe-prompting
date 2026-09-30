/** Composes profile persistence, revision pinning, and executable runtimes behind the public Target System API. */

import { createHash } from "node:crypto";

import { type ModelContext, standaloneModelContext } from "../clients/llm/context.ts";
import type { ContextSystem } from "../context-system/index.ts";
import type { Database } from "../database/index.ts";
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
  readonly #contexts: ContextSystem;

  constructor(
    database: Database,
    contexts: ContextSystem,
    models: ModelContext = standaloneModelContext,
  ) {
    this.#models = models;
    this.#profiles = new TargetProfiles(database, contexts);
    this.#contexts = contexts;
  }

  /** Creates a revisioned profile for an existing context. */
  async createProfile(actorUserId: string, input: CreateProfileInput): Promise<TargetProfile> {
    return this.#profiles.createProfile(actorUserId, input);
  }

  async getProfileForContext(contextId: string): Promise<TargetProfile> {
    return this.#profiles.getProfileForContext(contextId);
  }

  /** Persists a default profile only when the context has no explicit profile. */
  async ensureProfileForContext(actorUserId: string, contextId: string): Promise<TargetProfile> {
    return this.#profiles.ensureProfileForContext(actorUserId, contextId);
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
    const [profile, context] = await Promise.all([
      input.targetProfileId && input.targetProfileRevisionId
        ? this.#profiles.getRevision(
            input.contextId,
            input.targetProfileId,
            input.targetProfileRevisionId,
          )
        : this.#profiles.ensureProfileForContext(input.actorUserId, input.contextId),
      this.#contexts.getRevision(input.contextId, input.contextRevisionId),
    ]);
    const skill = context.skill;
    const effectiveInstructions = [
      profile.instructions,
      skill
        ? `Use the ${skill.name} skill for every user request. Read its complete SKILL.md before answering; follow its instructions. If you cannot read it, report the failure instead of proceeding without it.`
        : context.markdown,
    ]
      .filter(Boolean)
      .join("\n\n");
    const effectiveInstructionsHash = createHash("sha256")
      .update(
        skill
          ? JSON.stringify({
              runtime: "sandbox-skills-v1",
              instructions: effectiveInstructions,
              skill: { ...skill, markdown: context.markdown },
            })
          : effectiveInstructions,
      )
      .digest("hex");
    return {
      contextId: input.contextId,
      contextRevisionId: input.contextRevisionId,
      targetModel: input.targetModel,
      reasoningEffort: input.reasoningEffort,
      profile,
      effectiveInstructions,
      effectiveInstructionsHash,
      ...(skill && { skill: { ...skill, markdown: context.markdown } }),
    };
  }

  /** Opens an executable runtime from the same definition used to prepare durable evaluation records. */
  async createPinnedTarget(input: TargetPinInput): Promise<PinnedTarget> {
    return openTargetRuntime(await this.resolveDefinition(input), this.#models);
  }
}
