/** Owns Target Profile persistence, immutable revisions, and optimistic concurrency without constructing provider runtimes. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { Database, DatabaseClient } from "../database/index.ts";
import type { PromptSystem } from "../prompt-system/index.ts";
import { type TargetConfiguration, targetConfigurationSchema } from "./configuration.ts";

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

/** Reports target-profile validation and lifecycle failures with an HTTP-safe status code. */
export class TargetProfileError extends Error {
  readonly code: string | undefined;
  readonly statusCode: number;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.code = code;
    this.name = "TargetProfileError";
    this.statusCode = statusCode;
  }
}

type ProfileRow = {
  configuration: unknown;
  id: string;
  instructions: string;
  name: string;
  revisionId: string;
};

type ProfileHeadRow = {
  currentRevisionId: string;
  promptId: string;
};

type ProfileRevisionNumberRow = { revisionNumber: number };

export class TargetProfileNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(promptId: string) {
    super(`No target profile is configured for prompt ${promptId}.`);
    this.name = "TargetProfileNotFoundError";
  }
}

/** Keeps profile validation and transaction boundaries together for the public Target System. */
export class TargetProfiles {
  readonly #database: Database;
  readonly #prompts: PromptSystem;

  constructor(database: Database, prompts: PromptSystem) {
    this.#database = database;
    this.#prompts = prompts;
  }

  /** Creates the profile and its initial revision atomically after validating the owning prompt. */
  async createProfile(actorUserId: string, input: CreateProfileInput): Promise<TargetProfile> {
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
          id, target_profile_id, revision_number, instructions, configuration, created_by_user_id
        )
        VALUES (
          ${revisionId}, ${id}, 1, ${instructions},
          ${sql.json(configuration as postgres.JSONValue)}, ${actorUserId}
        )
      `;
      return requireProfileForPrompt(sql, input.promptId);
    });
  }

  /** Reads the current profile revision for a prompt without creating a default. */
  async getProfileForPrompt(promptId: string): Promise<TargetProfile> {
    return this.#database.run((sql) => requireProfileForPrompt(sql, promptId));
  }

  /** Persists the vanilla AI SDK agent only when a prompt has no explicit target override. */
  async ensureProfileForPrompt(actorUserId: string, promptId: string): Promise<TargetProfile> {
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
            id, target_profile_id, revision_number, instructions, configuration, created_by_user_id
          )
          VALUES (${revisionId}, ${id}, 1, '', ${sql.json({})}, ${actorUserId})
        `;
      }
      return requireProfileForPrompt(sql, promptId);
    });
  }

  /** Appends an immutable revision only when the expected profile head still matches. */
  async appendProfileRevision(
    actorUserId: string,
    input: ProfileRevisionInput,
  ): Promise<TargetProfile> {
    const instructions = input.instructions.trim();
    if (!instructions) throw new Error("Target profile instructions are required.");
    const configuration = targetConfigurationSchema.parse(input.configuration);
    return this.#database.transaction(async (sql) => {
      const [current] = await sql<ProfileHeadRow[]>`
        SELECT prompt_id, current_revision_id
        FROM target_profiles
        WHERE id = ${input.profileId}
        FOR UPDATE
      `;
      if (!current) throw new Error(`Target profile ${input.profileId} was not found.`);
      if (current.currentRevisionId !== input.expectedRevisionId) {
        throw new TargetProfileError("Someone saved a newer target profile.", 409, "stale-write");
      }
      const [revision] = await sql<ProfileRevisionNumberRow[]>`
        SELECT revision_number
        FROM target_profile_revisions
        WHERE id = ${current.currentRevisionId}
      `;
      if (!revision)
        throw new Error(`Target profile revision ${current.currentRevisionId} was not found.`);
      const revisionId = randomUUID();
      await sql`
        INSERT INTO target_profile_revisions (
          id, target_profile_id, parent_revision_id, revision_number, instructions, configuration,
          created_by_user_id
        )
        VALUES (
          ${revisionId}, ${input.profileId}, ${input.expectedRevisionId},
          ${revision.revisionNumber + 1}, ${instructions},
          ${sql.json(configuration as postgres.JSONValue)}, ${actorUserId}
        )
      `;
      await sql`
        UPDATE target_profiles
        SET current_revision_id = ${revisionId}
        WHERE id = ${input.profileId}
      `;
      return requireProfileForPrompt(sql, current.promptId);
    });
  }

  /** Resolves only revisions belonging to both the requested profile and prompt. */
  async getRevision(
    promptId: string,
    profileId: string,
    revisionId: string,
  ): Promise<TargetProfile> {
    return this.#database.run((sql) =>
      requireProfileRevision(sql, promptId, profileId, revisionId),
    );
  }
}

async function requireProfileRevision(
  sql: DatabaseClient,
  promptId: string,
  profileId: string,
  revisionId: string,
): Promise<TargetProfile> {
  const [row] = await sql<ProfileRow[]>`
    SELECT
      target_profiles.id,
      target_profiles.name,
      target_profile_revisions.id AS revision_id,
      target_profile_revisions.instructions,
      target_profile_revisions.configuration
    FROM target_profiles
    JOIN target_profile_revisions
      ON target_profile_revisions.target_profile_id = target_profiles.id
    WHERE target_profiles.prompt_id = ${promptId}
      AND target_profiles.id = ${profileId}
      AND target_profile_revisions.id = ${revisionId}
  `;
  if (!row) throw new TargetProfileNotFoundError(promptId);
  return {
    configuration: targetConfigurationSchema.parse(row.configuration),
    id: row.id,
    instructions: row.instructions,
    name: row.name,
    revisionId: row.revisionId,
  };
}

async function requireProfileForPrompt(
  sql: DatabaseClient,
  promptId: string,
): Promise<TargetProfile> {
  const [row] = await sql<ProfileRow[]>`
    SELECT
      target_profiles.id,
      target_profiles.name,
      target_profiles.current_revision_id AS revision_id,
      target_profile_revisions.instructions,
      target_profile_revisions.configuration
    FROM target_profiles
    JOIN target_profile_revisions
      ON target_profile_revisions.id = target_profiles.current_revision_id
    WHERE target_profiles.prompt_id = ${promptId}
  `;
  if (!row) throw new TargetProfileNotFoundError(promptId);
  return {
    configuration: targetConfigurationSchema.parse(row.configuration),
    id: row.id,
    instructions: row.instructions,
    name: row.name,
    revisionId: row.revisionId,
  };
}
