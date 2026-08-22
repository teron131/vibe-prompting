/** Owns administrative creation and initialization of the configured PostgreSQL database. */

import postgres from "postgres";

import { Database, DEFAULT_DATABASE_URL } from "./client.ts";

/** Initializes the configured database and creates it first when the server reports a missing database. */
export async function setupDatabase(
  databaseUrl: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<boolean> {
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
