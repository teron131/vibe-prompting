/** Owns Target Profile persistence, immutable revisions, and optimistic concurrency without constructing provider runtimes. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { ContextSystem } from "../context-system/index.ts";
import type { Database, DatabaseClient } from "../database/index.ts";
import {
  type CreateProfileInput,
  type ProfileRevisionInput,
  targetConfigurationSchema,
  type TargetProfile,
} from "./schemas.ts";

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
  contextId: string;
};

type ProfileRevisionNumberRow = { revisionNumber: number };

export class TargetProfileNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(contextId: string) {
    super(`No target profile is configured for context ${contextId}.`);
    this.name = "TargetProfileNotFoundError";
  }
}

/** Keeps profile validation and transaction boundaries together for the public Target System. */
export class TargetProfiles {
  readonly #database: Database;
  readonly #contexts: ContextSystem;

  constructor(database: Database, contexts: ContextSystem) {
    this.#database = database;
    this.#contexts = contexts;
  }

  /** Creates the profile and its initial revision atomically after validating the owning context. */
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
    await this.#contexts.getContext(input.contextId);
    const id = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO target_profiles (id, name, context_id, current_revision_id)
        VALUES (${id}, ${name}, ${input.contextId}, ${revisionId})
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
      return requireProfileForContext(sql, input.contextId);
    });
  }

  /** Reads the current profile revision for a context without creating a default. */
  async getProfileForContext(contextId: string): Promise<TargetProfile> {
    return this.#database.run((sql) => requireProfileForContext(sql, contextId));
  }

  /** Persists a default profile for prompt or skill execution only when the context has no explicit target override. */
  async ensureProfileForContext(actorUserId: string, contextId: string): Promise<TargetProfile> {
    const context = await this.#contexts.getContext(contextId);
    const name = context.skill ? "Skill agent" : "AI SDK agent";
    const id = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      const [created] = await sql<{ id: string }[]>`
        INSERT INTO target_profiles (id, name, context_id, current_revision_id)
        VALUES (${id}, ${name}, ${contextId}, ${revisionId})
        ON CONFLICT (context_id) DO NOTHING
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
      return requireProfileForContext(sql, contextId);
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
        SELECT context_id, current_revision_id
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
      return requireProfileForContext(sql, current.contextId);
    });
  }

  /** Resolves only revisions belonging to both the requested profile and context. */
  async getRevision(
    contextId: string,
    profileId: string,
    revisionId: string,
  ): Promise<TargetProfile> {
    return this.#database.run((sql) =>
      requireProfileRevision(sql, contextId, profileId, revisionId),
    );
  }
}

async function requireProfileRevision(
  sql: DatabaseClient,
  contextId: string,
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
    WHERE target_profiles.context_id = ${contextId}
      AND target_profiles.id = ${profileId}
      AND target_profile_revisions.id = ${revisionId}
  `;
  if (!row) throw new TargetProfileNotFoundError(contextId);
  return {
    configuration: targetConfigurationSchema.parse(row.configuration),
    id: row.id,
    instructions: row.instructions,
    name: row.name,
    revisionId: row.revisionId,
  };
}

async function requireProfileForContext(
  sql: DatabaseClient,
  contextId: string,
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
    WHERE target_profiles.context_id = ${contextId}
  `;
  if (!row) throw new TargetProfileNotFoundError(contextId);
  return {
    configuration: targetConfigurationSchema.parse(row.configuration),
    id: row.id,
    instructions: row.instructions,
    name: row.name,
    revisionId: row.revisionId,
  };
}
