/** Owns reusable named Criterion resources and the ordered Criteria permutations that reference them without becoming the source of truth for historical run snapshots. */

import { randomUUID } from "node:crypto";

import type postgres from "postgres";
import { z } from "zod";

import type { Database, DatabaseClient } from "../database/index.ts";
import { type Criterion, criterionSchema } from "./api.ts";

const resourceNameSchema = z.string().trim().min(1).max(120);
const savedCriterionSchema = criterionSchema.and(
  z.object({ id: z.uuid(), version: z.number().int().positive() }),
);

export const savedCriterionInputSchema = criterionSchema;
export const criteriaInputSchema = z.object({
  name: resourceNameSchema,
  criterionIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, "Criteria cannot repeat a Criterion."),
});

type CriterionRow = {
  definition: unknown;
  id: string;
  name: string;
  version: number;
};

type CriteriaRow = {
  criterionSequence: unknown;
  id: string;
  name: string;
  version: number;
};

export type SavedCriterion = Criterion & {
  id: string;
  version: number;
};

export type SavedCriterionInput = z.infer<typeof savedCriterionInputSchema>;

export type Criteria = {
  id: string;
  name: string;
  criterionSequence: SavedCriterion[];
  version: number;
};

export type CriteriaInput = z.infer<typeof criteriaInputSchema>;

/** Reports Criterion and Criteria validation or lifecycle failures with an HTTP-safe status code. */
export class CriterionError extends Error {
  readonly code: string | undefined;
  readonly statusCode: number;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.code = code;
    this.name = "CriterionError";
    this.statusCode = statusCode;
  }
}

/** Manages the shared Criterion library and ordered Criteria permutations through one database owner. */
export class CriterionLibrary {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async listCriterion(): Promise<SavedCriterion[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<CriterionRow[]>`
        SELECT id, name, definition_json AS definition, version
        FROM evaluation_criterion
        ORDER BY lower(name), id
      `;
      return rows.map(parseSavedCriterion);
    });
  }

  async getCriterion(id: string): Promise<SavedCriterion> {
    return this.#database.run((sql) => requireCriterion(sql, id));
  }

  async createCriterion(actorUserId: string, value: unknown): Promise<SavedCriterion> {
    const input = parseCriterionInput(value);
    return this.#database.run(async (sql) => {
      await requireAvailableCriterionName(sql, input.name);
      const { name, ...definition } = input;
      const [row] = await sql<CriterionRow[]>`
        INSERT INTO evaluation_criterion (
          id,
          name,
          definition_json,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (
          ${randomUUID()},
          ${name},
          ${sql.json(definition as postgres.JSONValue)},
          ${actorUserId},
          ${actorUserId}
        )
        RETURNING id, name, definition_json AS definition, version
      `;
      if (!row) throw new Error("Criterion creation returned no record.");
      return parseSavedCriterion(row);
    });
  }

  async updateCriterion(
    actorUserId: string,
    id: string,
    expectedVersion: number,
    value: unknown,
  ): Promise<SavedCriterion> {
    const input = parseCriterionInput(value);
    return this.#database.transaction(async (sql) => {
      await requireAvailableCriterionName(sql, input.name, id);
      const { name, ...definition } = input;
      const [row] = await sql<CriterionRow[]>`
        UPDATE evaluation_criterion
        SET
          name = ${name},
          definition_json = ${sql.json(definition as postgres.JSONValue)},
          version = version + 1,
          updated_by_user_id = ${actorUserId}
        WHERE id = ${id} AND version = ${expectedVersion}
        RETURNING id, name, definition_json AS definition, version
      `;
      if (!row) await throwMissingCriterionOrConflict(sql, id);
      return parseSavedCriterion(row);
    });
  }

  async deleteCriterion(id: string, expectedVersion: number): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const [usage] = await sql<{ name: string }[]>`
        SELECT evaluation_criteria.name
        FROM evaluation_criteria_items
        JOIN evaluation_criteria
          ON evaluation_criteria.id = evaluation_criteria_items.criteria_id
        WHERE evaluation_criteria_items.criterion_id = ${id}
        ORDER BY lower(evaluation_criteria.name), evaluation_criteria.id
        LIMIT 1
      `;
      if (usage) {
        throw new CriterionError(
          `Remove this Criterion from “${usage.name}” and every other Criteria permutation before deleting it.`,
          409,
          "criterion-in-use",
        );
      }
      const [deleted] = await sql<{ id: string }[]>`
        DELETE FROM evaluation_criterion
        WHERE id = ${id} AND version = ${expectedVersion}
        RETURNING id
      `;
      if (!deleted) await throwMissingCriterionOrConflict(sql, id);
    });
  }

  async listCriteria(): Promise<Criteria[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<CriteriaRow[]>`
        ${criteriaProjection(sql)}
        ORDER BY lower(evaluation_criteria.name), evaluation_criteria.id
      `;
      return rows.map(parseCriteria);
    });
  }

  async getCriteria(id: string): Promise<Criteria> {
    return this.#database.run((sql) => requireCriteria(sql, id));
  }

  async createCriteria(actorUserId: string, value: unknown): Promise<Criteria> {
    const input = parseCriteriaInput(value);
    return this.#database.transaction(async (sql) => {
      await requireAvailableCriteriaName(sql, input.name);
      await requireCriterionIds(sql, input.criterionIds);
      const id = randomUUID();
      await sql`
        INSERT INTO evaluation_criteria (
          id,
          name,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (${id}, ${input.name}, ${actorUserId}, ${actorUserId})
      `;
      await insertCriteriaItems(sql, id, input.criterionIds);
      return requireCriteria(sql, id);
    });
  }

  async updateCriteria(
    actorUserId: string,
    id: string,
    expectedVersion: number,
    value: unknown,
  ): Promise<Criteria> {
    const input = parseCriteriaInput(value);
    return this.#database.transaction(async (sql) => {
      await requireAvailableCriteriaName(sql, input.name, id);
      await requireCriterionIds(sql, input.criterionIds);
      const [updated] = await sql<{ id: string }[]>`
        UPDATE evaluation_criteria
        SET
          name = ${input.name},
          version = version + 1,
          updated_by_user_id = ${actorUserId}
        WHERE id = ${id} AND version = ${expectedVersion}
        RETURNING id
      `;
      if (!updated) await throwMissingCriteriaOrConflict(sql, id);
      await sql`DELETE FROM evaluation_criteria_items WHERE criteria_id = ${id}`;
      await insertCriteriaItems(sql, id, input.criterionIds);
      return requireCriteria(sql, id);
    });
  }

  async deleteCriteria(id: string, expectedVersion: number): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const [deleted] = await sql<{ id: string }[]>`
        DELETE FROM evaluation_criteria
        WHERE id = ${id} AND version = ${expectedVersion}
        RETURNING id
      `;
      if (!deleted) await throwMissingCriteriaOrConflict(sql, id);
    });
  }
}

function criteriaProjection(sql: DatabaseClient) {
  return sql`
    SELECT
      evaluation_criteria.id,
      evaluation_criteria.name,
      evaluation_criteria.version,
      jsonb_agg(
        evaluation_criterion.definition_json || jsonb_build_object(
          'id', evaluation_criterion.id,
          'name', evaluation_criterion.name,
          'version', evaluation_criterion.version
        )
        ORDER BY evaluation_criteria_items.position
      ) AS criterion_sequence
    FROM evaluation_criteria
    JOIN evaluation_criteria_items
      ON evaluation_criteria_items.criteria_id = evaluation_criteria.id
    JOIN evaluation_criterion
      ON evaluation_criterion.id = evaluation_criteria_items.criterion_id
    GROUP BY evaluation_criteria.id
  `;
}

async function requireCriterion(sql: DatabaseClient, id: string): Promise<SavedCriterion> {
  const [row] = await sql<CriterionRow[]>`
    SELECT id, name, definition_json AS definition, version
    FROM evaluation_criterion
    WHERE id = ${id}
  `;
  if (!row) throw new CriterionError(`Criterion ${id} was not found.`, 404);
  return parseSavedCriterion(row);
}

async function requireCriteria(sql: DatabaseClient, id: string): Promise<Criteria> {
  const [row] = await sql<CriteriaRow[]>`
    ${criteriaProjection(sql)}
    HAVING evaluation_criteria.id = ${id}
  `;
  if (!row) throw new CriterionError(`Criteria ${id} was not found.`, 404);
  return parseCriteria(row);
}

async function requireAvailableCriterionName(
  sql: DatabaseClient,
  name: string,
  excludedId?: string,
): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`
    SELECT id
    FROM evaluation_criterion
    WHERE lower(btrim(name)) = lower(btrim(${name}))
      AND (${excludedId ?? null}::uuid IS NULL OR id <> ${excludedId ?? null}::uuid)
  `;
  if (existing) throw new CriterionError(`A Criterion named “${name}” already exists.`, 409);
}

async function requireAvailableCriteriaName(
  sql: DatabaseClient,
  name: string,
  excludedId?: string,
): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`
    SELECT id
    FROM evaluation_criteria
    WHERE lower(btrim(name)) = lower(btrim(${name}))
      AND (${excludedId ?? null}::uuid IS NULL OR id <> ${excludedId ?? null}::uuid)
  `;
  if (existing) throw new CriterionError(`Criteria named “${name}” already exists.`, 409);
}

async function requireCriterionIds(sql: DatabaseClient, ids: string[]): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM evaluation_criterion
    WHERE id = ANY(${sql.array(ids)}::uuid[])
    FOR KEY SHARE
  `;
  if (rows.length !== ids.length) {
    throw new CriterionError("One or more selected Criterion resources were not found.", 400);
  }
}

async function insertCriteriaItems(
  sql: DatabaseClient,
  criteriaId: string,
  ids: string[],
): Promise<void> {
  await sql`
    INSERT INTO evaluation_criteria_items (criteria_id, criterion_id, position)
    SELECT ${criteriaId}, selected.criterion_id, selected.ordinality - 1
    FROM unnest(${sql.array(ids)}::uuid[]) WITH ORDINALITY AS selected(criterion_id, ordinality)
  `;
}

function parseSavedCriterion(row: CriterionRow): SavedCriterion {
  return savedCriterionSchema.parse({
    ...requireRecord(row.definition),
    id: row.id,
    name: row.name,
    version: row.version,
  });
}

function parseCriteria(row: CriteriaRow): Criteria {
  const criterionSequence = z.array(savedCriterionSchema).parse(row.criterionSequence);
  return { criterionSequence, id: row.id, name: row.name, version: row.version };
}

function parseCriterionInput(value: unknown): SavedCriterionInput {
  const result = savedCriterionInputSchema.safeParse(value);
  if (!result.success) {
    throw new CriterionError(result.error.issues[0]?.message ?? "Criterion input is invalid.", 400);
  }
  return result.data;
}

function parseCriteriaInput(value: unknown): CriteriaInput {
  const result = criteriaInputSchema.safeParse(value);
  if (!result.success) {
    throw new CriterionError(result.error.issues[0]?.message ?? "Criteria input is invalid.", 400);
  }
  return result.data;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persisted Criterion definition must be an object.");
  }
  return value as Record<string, unknown>;
}

async function throwMissingCriterionOrConflict(sql: DatabaseClient, id: string): Promise<never> {
  const [current] = await sql<{ version: number }[]>`
    SELECT version FROM evaluation_criterion WHERE id = ${id}
  `;
  if (!current) throw new CriterionError(`Criterion ${id} was not found.`, 404);
  throw new CriterionError("Someone saved a newer version of this Criterion.", 409, "stale-write");
}

async function throwMissingCriteriaOrConflict(sql: DatabaseClient, id: string): Promise<never> {
  const [current] = await sql<{ version: number }[]>`
    SELECT version FROM evaluation_criteria WHERE id = ${id}
  `;
  if (!current) throw new CriterionError(`Criteria ${id} was not found.`, 404);
  throw new CriterionError("Someone saved a newer Criteria version.", 409, "stale-write");
}
