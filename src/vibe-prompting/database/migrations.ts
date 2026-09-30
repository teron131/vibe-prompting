/** Owns the ordered migration manifest and its advisory-locked application policy. */

import { readFile } from "node:fs/promises";

import type postgres from "postgres";

import { readSkillMetadata, SkillFormatError } from "../context-system/skills.ts";

const SCHEMA_MIGRATION_LOCK = 1_450_701_647;
const MIGRATIONS = [
  {
    load: () => readFile(new URL("../../../migrations/001_schema.sql", import.meta.url), "utf8"),
    version: 1,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/007_model_price_cache.sql", import.meta.url), "utf8"),
    version: 7,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/008_scenario_runs.sql", import.meta.url), "utf8"),
    version: 8,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/009_named_criteria.sql", import.meta.url), "utf8"),
    version: 9,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/010_skill_metadata.sql", import.meta.url), "utf8"),
    version: 10,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/011_context_library.sql", import.meta.url), "utf8"),
    version: 11,
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
      if (migration.version === 10) {
        const revisions = await sql<
          { id: string; markdown: string }[]
        >`SELECT id, markdown FROM prompt_revisions`;
        for (const revision of revisions) {
          try {
            const skill = readSkillMetadata(revision.markdown);
            if (skill)
              await sql`UPDATE prompt_revisions SET skill = ${sql.json(skill)} WHERE id = ${revision.id}`;
          } catch (error) {
            // Existing nonstandard frontmatter remains a context; new revisions must pass skill validation.
            if (!(error instanceof SkillFormatError)) throw error;
          }
        }
      }
      await sql`
        INSERT INTO schema_migrations (version)
        VALUES (${migration.version})
      `;
    }
  });
}
