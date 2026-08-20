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

const LANGUAGE: Criterion = {
  type: "boolean",
  instruction:
    "Language gate — Answer English input in English and Chinese input in written Traditional Chinese.",
};
const INTENT: Criterion = {
  type: "boolean",
  instruction:
    "Intention gate — Complete supported work, decline only unsupported parts, and avoid unnecessary scope expansion.",
};
const TOOL_USAGE: Criterion = {
  type: "categorical",
  instruction:
    "Tool usage — Use relevant evidence and direct source links when the request requires external facts; never invent evidence.",
  categories: ["fail", "partial", "pass"],
};
const RESPONSE_QUALITY: Criterion = {
  type: "categorical",
  instruction:
    "Response quality — Produce a correct, grounded, concise, practical, and directly actionable final answer.",
  categories: ["bad", "decent", "good"],
};

const DEFAULT_PROFILES = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    name: "Language only",
    criteria: [LANGUAGE, INTENT],
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    name: "Tool use only",
    criteria: [TOOL_USAGE],
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    name: "Full quality gate",
    criteria: [LANGUAGE, INTENT, TOOL_USAGE, RESPONSE_QUALITY],
  },
] as const satisfies readonly { id: string; name: string; criteria: Criterion[] }[];

type ProfileRow = {
  id: string;
  name: string;
  criteria: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CriteriaProfile = {
  id: string;
  name: string;
  criteria: Criterion[];
  isDefault: boolean;
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

/** Manages reusable criteria profiles and keeps default profiles undeletable. */
export class CriteriaProfiles {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Seeds built-in profiles idempotently so existing user profiles remain untouched. */
  async initialize(): Promise<void> {
    await this.#database.run(async (sql) => {
      for (const profile of DEFAULT_PROFILES) {
        await sql`
          INSERT INTO evaluation_criteria_profiles (id, name, criteria_json, is_default)
          VALUES (
            ${profile.id},
            ${profile.name},
            ${sql.json(profile.criteria as postgres.JSONValue[])},
            true
          )
          ON CONFLICT DO NOTHING
        `;
      }
    });
  }

  /** Lists profiles in stable default-first, case-insensitive name order. */
  async list(): Promise<CriteriaProfile[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<ProfileRow[]>`
        SELECT id, name, criteria_json AS criteria, is_default, created_at, updated_at
        FROM evaluation_criteria_profiles
        ORDER BY is_default DESC, lower(name), id
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
        RETURNING id, name, criteria_json AS criteria, is_default, created_at, updated_at
      `;
      if (!row) throw new Error("Criteria profile creation returned no record.");
      return parseProfile(row);
    });
  }

  /** Replaces a profile atomically while preserving its identity and default status. */
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
        RETURNING id, name, criteria_json AS criteria, is_default, created_at, updated_at
      `;
      if (!row) throw new Error("Criteria profile update returned no record.");
      return parseProfile(row);
    });
  }

  /** Deletes a user profile and rejects deletion of built-in profiles. */
  async delete(id: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const profile = await requireProfile(sql, id);
      if (profile.isDefault)
        throw new CriteriaProfileError("Default criteria profiles cannot be deleted.", 409);
      await sql`DELETE FROM evaluation_criteria_profiles WHERE id = ${id}`;
    });
  }
}

async function requireProfile(sql: DatabaseClient, id: string): Promise<CriteriaProfile> {
  const [row] = await sql<ProfileRow[]>`
    SELECT id, name, criteria_json AS criteria, is_default, created_at, updated_at
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
    isDefault: row.isDefault,
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
