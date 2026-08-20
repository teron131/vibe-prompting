/** Owns database-backed target profiles and constructs pinned Vercel AI SDK targets without leaking profile policy into deployed source. */

import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { connectAiSdkExaSearch } from "../clients/exa.ts";
import { createModel } from "../clients/llm/ai-sdk.ts";
import type { Database, DatabaseClient } from "../database.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import { createAiSdkTarget, type TargetConfiguration, targetConfigurationSchema } from "./agent.ts";
import type { Target } from "./api.ts";

export type TargetProfile = {
  configuration: TargetConfiguration;
  createdAt: string;
  id: string;
  instructions: string;
  name: string;
  promptId: string;
  revisionId: string;
  revisionNumber: number;
  updatedAt: string;
};

export type PinnedTarget = {
  close(): Promise<void>;
  effectiveInstructionsHash: string;
  profile: TargetProfile;
  target: Target<string, string>;
};

/** Reports target-profile validation and lifecycle failures with an HTTP-safe status code. */
export class TargetProfileError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TargetProfileError";
    this.statusCode = statusCode;
  }
}

type ProfileRow = {
  configuration: unknown;
  createdAt: Date;
  id: string;
  instructions: string;
  name: string;
  promptId: string;
  revisionId: string;
  revisionNumber: number;
  updatedAt: Date;
};

type ProfileHeadRow = {
  currentRevisionId: string;
  promptId: string;
  revisionNumber: number;
};

export class TargetProfileNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(promptId: string) {
    super(`No target profile is configured for prompt ${promptId}.`);
    this.name = "TargetProfileNotFoundError";
  }
}

export class TargetSystem {
  readonly #database: Database;
  readonly #prompts: PromptSystem;

  constructor(database: Database, prompts: PromptSystem) {
    this.#database = database;
    this.#prompts = prompts;
  }

  async createProfile(input: {
    configuration: TargetConfiguration;
    instructions: string;
    name: string;
    promptId: string;
  }): Promise<TargetProfile> {
    const name = input.name.trim();
    const instructions = input.instructions.trim();
    if (!name) throw new TargetProfileError("Target profile name is required.", 400);
    if (!instructions)
      throw new TargetProfileError("Target profile instructions are required.", 400);
    const parsedConfiguration = targetConfigurationSchema.safeParse(input.configuration);
    if (!parsedConfiguration.success) {
      throw new TargetProfileError(
        parsedConfiguration.error.issues[0]?.message ?? "Target configuration is invalid.",
        400,
      );
    }
    const configuration = parsedConfiguration.data;
    await this.#prompts.getPrompt(input.promptId);
    const id = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO target_profiles (id, name, prompt_id, current_revision_id)
        VALUES (${id}, ${name}, ${input.promptId}, ${revisionId})
      `;
      await sql`
        INSERT INTO target_profile_revisions (
          id, target_profile_id, revision_number, instructions, configuration
        )
        VALUES (
          ${revisionId}, ${id}, 1, ${instructions},
          ${sql.json(configuration as postgres.JSONValue)}
        )
      `;
      return requireProfileForPrompt(sql, input.promptId);
    });
  }

  async getProfileForPrompt(promptId: string): Promise<TargetProfile> {
    return this.#database.run((sql) => requireProfileForPrompt(sql, promptId));
  }

  /** Persists the vanilla AI SDK agent only when a prompt has no explicit target override. */
  async ensureProfileForPrompt(promptId: string): Promise<TargetProfile> {
    await this.#prompts.getPrompt(promptId);
    const id = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      const [created] = await sql<{ id: string }[]>`
        INSERT INTO target_profiles (id, name, prompt_id, current_revision_id)
        VALUES (${id}, 'AI SDK agent', ${promptId}, ${revisionId})
        ON CONFLICT (prompt_id) DO NOTHING
        RETURNING id
      `;
      if (created) {
        await sql`
          INSERT INTO target_profile_revisions (
            id, target_profile_id, revision_number, instructions, configuration
          )
          VALUES (${revisionId}, ${id}, 1, '', ${sql.json({})})
        `;
      }
      return requireProfileForPrompt(sql, promptId);
    });
  }

  async appendProfileRevision(input: {
    configuration: TargetConfiguration;
    expectedRevisionId: string;
    instructions: string;
    profileId: string;
  }): Promise<TargetProfile> {
    const instructions = input.instructions.trim();
    if (!instructions) throw new Error("Target profile instructions are required.");
    const configuration = targetConfigurationSchema.parse(input.configuration);
    return this.#database.transaction(async (sql) => {
      const [current] = await sql<ProfileHeadRow[]>`
        SELECT
          target_profiles.prompt_id,
          target_profiles.current_revision_id,
          target_profile_revisions.revision_number
        FROM target_profiles
        JOIN target_profile_revisions
          ON target_profile_revisions.id = target_profiles.current_revision_id
        WHERE target_profiles.id = ${input.profileId}
        FOR UPDATE OF target_profiles
      `;
      if (!current) throw new Error(`Target profile ${input.profileId} was not found.`);
      if (current.currentRevisionId !== input.expectedRevisionId) {
        throw new Error(
          "This target profile changed after it was loaded. Reload it before editing again.",
        );
      }
      const revisionId = randomUUID();
      await sql`
        INSERT INTO target_profile_revisions (
          id, target_profile_id, parent_revision_id, revision_number, instructions, configuration
        )
        VALUES (
          ${revisionId}, ${input.profileId}, ${input.expectedRevisionId},
          ${current.revisionNumber + 1}, ${instructions},
          ${sql.json(configuration as postgres.JSONValue)}
        )
      `;
      await sql`
        UPDATE target_profiles
        SET current_revision_id = ${revisionId}, updated_at = now()
        WHERE id = ${input.profileId}
      `;
      return requireProfileForPrompt(sql, current.promptId);
    });
  }

  async createPinnedTarget(input: {
    promptId: string;
    promptRevisionId: string;
    targetModelId: string;
  }): Promise<PinnedTarget> {
    const [profile, prompt] = await Promise.all([
      this.ensureProfileForPrompt(input.promptId),
      this.#prompts.getRevision(input.promptId, input.promptRevisionId),
    ]);
    const effectiveInstructions = [profile.instructions, prompt.markdown]
      .filter(Boolean)
      .join("\n\n");
    const effectiveInstructionsHash = createHash("sha256")
      .update(effectiveInstructions)
      .digest("hex");
    const model = createModel(input.targetModelId);
    const exa = profile.configuration.tools?.includes("web-search")
      ? await connectAiSdkExaSearch()
      : undefined;
    const target = createAiSdkTarget({
      configuration: profile.configuration,
      instructions: effectiveInstructions,
      model,
      modelId: input.targetModelId,
      profileId: profile.id,
      tools: exa?.tools,
    });
    return {
      close: () => exa?.close() ?? Promise.resolve(),
      effectiveInstructionsHash,
      profile,
      target,
    };
  }
}

async function requireProfileForPrompt(
  sql: DatabaseClient,
  promptId: string,
): Promise<TargetProfile> {
  const [row] = await sql<ProfileRow[]>`
    SELECT
      target_profiles.id,
      target_profiles.name,
      target_profiles.prompt_id,
      target_profiles.current_revision_id AS revision_id,
      target_profile_revisions.revision_number,
      target_profile_revisions.instructions,
      target_profile_revisions.configuration,
      target_profiles.created_at,
      target_profiles.updated_at
    FROM target_profiles
    JOIN target_profile_revisions
      ON target_profile_revisions.id = target_profiles.current_revision_id
    WHERE target_profiles.prompt_id = ${promptId}
  `;
  if (!row) throw new TargetProfileNotFoundError(promptId);
  return {
    configuration: targetConfigurationSchema.parse(row.configuration),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    instructions: row.instructions,
    name: row.name,
    promptId: row.promptId,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    updatedAt: row.updatedAt.toISOString(),
  };
}
