/** Owns the ordered migration manifest and its advisory-locked application policy. */

import { readFile } from "node:fs/promises";

import type postgres from "postgres";

const SCHEMA_MIGRATION_LOCK = 1_450_701_647;
const MIGRATIONS = [
  {
    load: () => readFile(new URL("../../../migrations/001_schema.sql", import.meta.url), "utf8"),
    version: 1,
  },
];

export async function applyMigrations(database: postgres.Sql): Promise<void> {
  await database.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK})`;
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    for (const migration of MIGRATIONS) {
      const [applied] = await sql<{ version: number }[]>`
        SELECT version
        FROM schema_migrations
        WHERE version = ${migration.version}
      `;
      if (applied) continue;
      const source = await migration.load();
      await sql.unsafe(source).simple();
      await sql`
        INSERT INTO schema_migrations (version)
        VALUES (${migration.version})
      `;
    }
  });
}
