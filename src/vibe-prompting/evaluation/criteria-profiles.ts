/** Owns durable reusable criteria profiles while preserving criterion order and the evaluator's exact public criterion contract. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";
import { z } from "zod";

import type { Database, DatabaseClient } from "../database.ts";
import { criteriaSchema, type Criterion } from "./api.ts";

export const criteriaProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  criteria: criteriaSchema,
});

type ProfileRow = {
  id: string;
  name: string;
  criteria: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type CriteriaProfile = {
  id: string;
  name: string;
  criteria: Criterion[];
  createdAt: string;
  updatedAt: string;
};

export type CriteriaProfileInput = z.infer<typeof criteriaProfileInputSchema>;

/** Reports profile validation and lifecycle failures with an HTTP-safe status code. */
export class CriteriaProfileError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CriteriaProfileError";
    this.statusCode = statusCode;
  }
}

/** Manages reusable criteria profiles without embedding profile content or lifecycle tiers in application code. */
export class CriteriaProfiles {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Lists profiles in stable case-insensitive name order. */
  async list(): Promise<CriteriaProfile[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<ProfileRow[]>`
        SELECT id, name, criteria_json AS criteria, created_at, updated_at
        FROM evaluation_criteria_profiles
        ORDER BY lower(name), id
      `;
      return rows.map(parseProfile);
    });
  }

  /** Loads a profile and validates persisted criteria against the evaluator contract. */
  async get(id: string): Promise<CriteriaProfile> {
    return this.#database.run((sql) => requireProfile(sql, id));
  }

  /** Validates and persists a named profile after enforcing case-insensitive name uniqueness. */
  async create(value: unknown): Promise<CriteriaProfile> {
    const input = parseProfileInput(value);
    return this.#database.run(async (sql) => {
      await requireAvailableName(sql, input.name);
      const [row] = await sql<ProfileRow[]>`
        INSERT INTO evaluation_criteria_profiles (id, name, criteria_json)
        VALUES (
          ${randomUUID()},
          ${input.name},
          ${sql.json(input.criteria as postgres.JSONValue[])}
        )
        RETURNING id, name, criteria_json AS criteria, created_at, updated_at
      `;
      if (!row) throw new Error("Criteria profile creation returned no record.");
      return parseProfile(row);
    });
  }

  /** Replaces a profile atomically while preserving its identity. */
  async update(id: string, value: unknown): Promise<CriteriaProfile> {
    const input = parseProfileInput(value);
    return this.#database.transaction(async (sql) => {
      await requireProfile(sql, id);
      await requireAvailableName(sql, input.name, id);
      const [row] = await sql<ProfileRow[]>`
        UPDATE evaluation_criteria_profiles
        SET
          name = ${input.name},
          criteria_json = ${sql.json(input.criteria as postgres.JSONValue[])},
          updated_at = now()
        WHERE id = ${id}
        RETURNING id, name, criteria_json AS criteria, created_at, updated_at
      `;
      if (!row) throw new Error("Criteria profile update returned no record.");
      return parseProfile(row);
    });
  }

  /** Deletes a persisted profile. */
  async delete(id: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      await requireProfile(sql, id);
      await sql`DELETE FROM evaluation_criteria_profiles WHERE id = ${id}`;
    });
  }
}

async function requireProfile(sql: DatabaseClient, id: string): Promise<CriteriaProfile> {
  const [row] = await sql<ProfileRow[]>`
    SELECT id, name, criteria_json AS criteria, created_at, updated_at
    FROM evaluation_criteria_profiles
    WHERE id = ${id}
  `;
  if (!row) throw new CriteriaProfileError(`Criteria profile ${id} was not found.`, 404);
  return parseProfile(row);
}

async function requireAvailableName(
  sql: DatabaseClient,
  name: string,
  excludedId?: string,
): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`
    SELECT id
    FROM evaluation_criteria_profiles
    WHERE lower(btrim(name)) = lower(btrim(${name}))
      AND (${excludedId ?? null}::uuid IS NULL OR id <> ${excludedId ?? null}::uuid)
  `;
  if (existing)
    throw new CriteriaProfileError(`A criteria profile named “${name}” already exists.`, 409);
}

function parseProfile(row: ProfileRow): CriteriaProfile {
  return {
    id: row.id,
    name: row.name,
    criteria: criteriaSchema.parse(row.criteria),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseProfileInput(value: unknown): CriteriaProfileInput {
  const result = criteriaProfileInputSchema.safeParse(value);
  if (!result.success) {
    throw new CriteriaProfileError(
      result.error.issues[0]?.message ?? "Criteria profile input is invalid.",
      400,
    );
  }
  return result.data;
}
