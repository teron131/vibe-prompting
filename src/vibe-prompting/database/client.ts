/** Owns the shared PostgreSQL pool and transaction boundary used by application stores. */

import postgres from "postgres";

import { applyMigrations } from "./migrations.ts";

export const DEFAULT_DATABASE_URL = "postgresql://localhost/vibe_prompting";

export type DatabaseClient = postgres.Sql | postgres.TransactionSql;

/** Owns one application pool and keeps schema migration and transaction boundaries explicit to stores. */
export class Database {
  readonly #sql: postgres.Sql;

  constructor(
    databaseUrl: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    host: string | undefined = process.env.DATABASE_HOST,
  ) {
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
    await applyMigrations(this.#sql);
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
