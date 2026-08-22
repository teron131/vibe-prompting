/** Owns the ordered migration manifest and its advisory-locked application policy. */

import { readFile } from "node:fs/promises";

import type postgres from "postgres";

const SCHEMA_MIGRATION_LOCK = 1_450_701_647;
const MIGRATIONS = [
  {
    load: () =>
      readFile(new URL("../../../migrations/001_prompt_system.sql", import.meta.url), "utf8"),
    version: 1,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/002_conversations.sql", import.meta.url), "utf8"),
    version: 2,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/003_evaluation_system.sql", import.meta.url), "utf8"),
    version: 3,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/004_application.sql", import.meta.url), "utf8"),
    version: 4,
  },
  {
    load: () => readFile(new URL("../../../migrations/005_target.sql", import.meta.url), "utf8"),
    version: 5,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/006_prompt_deletion.sql", import.meta.url), "utf8"),
    version: 6,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/007_evaluation_provenance.sql", import.meta.url),
        "utf8",
      ),
    version: 7,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/008_evaluation_workspace_indexes.sql", import.meta.url),
        "utf8",
      ),
    version: 8,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/009_evaluation_criteria_profiles.sql", import.meta.url),
        "utf8",
      ),
    version: 9,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/010_search_embeddings.sql", import.meta.url), "utf8"),
    version: 10,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/011_database_owned_criteria_profiles.sql", import.meta.url),
        "utf8",
      ),
    version: 11,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/012_default_ai_sdk_target.sql", import.meta.url),
        "utf8",
      ),
    version: 12,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/013_prompt_active_revision.sql", import.meta.url),
        "utf8",
      ),
    version: 13,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/014_helper_model_setting.sql", import.meta.url),
        "utf8",
      ),
    version: 14,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/015_schema_optimization.sql", import.meta.url), "utf8"),
    version: 15,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/016_backend_schema_cleanup.sql", import.meta.url),
        "utf8",
      ),
    version: 16,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/017_target_runs.sql", import.meta.url), "utf8"),
    version: 17,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/018_target_run_activity.sql", import.meta.url), "utf8"),
    version: 18,
  },
  {
    load: () =>
      readFile(
        new URL("../../../migrations/019_target_run_reasoning.sql", import.meta.url),
        "utf8",
      ),
    version: 19,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/020_authentication.sql", import.meta.url), "utf8"),
    version: 20,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/021_multiuser_ownership.sql", import.meta.url), "utf8"),
    version: 21,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/022_workflow_queue.sql", import.meta.url), "utf8"),
    version: 22,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/023_invitation_throttle.sql", import.meta.url), "utf8"),
    version: 23,
  },
  {
    load: () =>
      readFile(new URL("../../../migrations/024_auth_schema_cleanup.sql", import.meta.url), "utf8"),
    version: 24,
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
