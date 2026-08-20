/** Owns the shared PostgreSQL connection, numbered migrations, and transaction boundary for application stores. */

import { readFile } from "node:fs/promises";

import postgres from "postgres";

const DEFAULT_DATABASE_URL = "postgresql://localhost/vibe_prompting";
const SCHEMA_MIGRATION_LOCK = 1_450_701_647;
const MIGRATIONS = [
  {
    load: () =>
      readFile(new URL("../../migrations/001_prompt_system.sql", import.meta.url), "utf8"),
    version: 1,
  },
  {
    load: () =>
      readFile(new URL("../../migrations/002_conversations.sql", import.meta.url), "utf8"),
    version: 2,
  },
  {
    load: () =>
      readFile(new URL("../../migrations/003_evaluation_system.sql", import.meta.url), "utf8"),
    version: 3,
  },
  {
    load: () => readFile(new URL("../../migrations/004_application.sql", import.meta.url), "utf8"),
    version: 4,
  },
  {
    load: () => readFile(new URL("../../migrations/005_target.sql", import.meta.url), "utf8"),
    version: 5,
  },
  {
    load: () =>
      readFile(new URL("../../migrations/006_prompt_deletion.sql", import.meta.url), "utf8"),
    version: 6,
  },
  {
    load: () =>
      readFile(new URL("../../migrations/007_evaluation_provenance.sql", import.meta.url), "utf8"),
    version: 7,
  },
  {
    load: () =>
      readFile(
        new URL("../../migrations/008_evaluation_workspace_indexes.sql", import.meta.url),
        "utf8",
      ),
    version: 8,
  },
  {
    load: () =>
      readFile(
        new URL("../../migrations/009_evaluation_criteria_profiles.sql", import.meta.url),
        "utf8",
      ),
    version: 9,
  },
  {
    load: () =>
      readFile(new URL("../../migrations/010_search_embeddings.sql", import.meta.url), "utf8"),
    version: 10,
  },
];

export type DatabaseClient = postgres.Sql | postgres.TransactionSql;

/** Owns one application pool and keeps schema migration and transaction boundaries explicit to stores. */
export class Database {
  readonly #sql: postgres.Sql;

  constructor(databaseUrl: string, host: string | undefined = process.env.DATABASE_HOST) {
    if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required for application storage.");
    this.#sql = postgres(databaseUrl, {
      connect_timeout: 10,
      ...(host ? { host } : {}),
      max: 5,
      onnotice: () => undefined,
      transform: postgres.camel,
    });
  }

  /** Applies each numbered migration once while holding a database-wide advisory lock. */
  async initialize(): Promise<void> {
    await this.#sql.begin(async (sql) => {
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

  /** Drains the pool so server shutdown does not leave database work behind. */
  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }

  /** Runs one read or write operation using the shared pool without opening an implicit transaction. */
  async run<T>(operation: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    return operation(this.#sql);
  }

  /** Runs one operation in a transaction and rolls it back when the callback rejects. */
  async transaction<T>(operation: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await this.#sql.begin(operation)) as T;
  }
}

export function createDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Database {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for application storage.");
  return new Database(databaseUrl);
}

/** Initializes the configured database and creates it first when the server reports a missing database. */
export async function setupDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<boolean> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for application storage.");

  const database = new Database(databaseUrl);
  try {
    await database.initialize();
    return false;
  } catch (error) {
    if (!hasPostgresCode(error, "3D000")) throw error;
  } finally {
    await database.close();
  }

  await createMissingDatabase(databaseUrl);
  const createdDatabase = new Database(databaseUrl);
  try {
    await createdDatabase.initialize();
  } finally {
    await createdDatabase.close();
  }
  return true;
}

async function createMissingDatabase(
  databaseUrl: string,
  host: string | undefined = process.env.DATABASE_HOST,
): Promise<void> {
  const targetUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(targetUrl.pathname.slice(1));
  if (!databaseName) throw new Error("DATABASE_URL must name a PostgreSQL database.");

  const maintenanceUrl = new URL(targetUrl);
  maintenanceUrl.pathname = "/postgres";
  const sql = postgres(maintenanceUrl.toString(), {
    connect_timeout: 10,
    ...(host ? { host } : {}),
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await sql`CREATE DATABASE ${sql(databaseName)}`;
  } catch (error) {
    if (!hasPostgresCode(error, "42P04")) throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
