/** Imports the captured example workspace from external fixture data without coupling examples to schema migrations. */

import "dotenv/config";
import { readFile } from "node:fs/promises";

import { DEFAULT_DATABASE_URL } from "../src/vibe-prompting/database/client.ts";
import { Database } from "../src/vibe-prompting/database/index.ts";
import { setupDatabase } from "../src/vibe-prompting/database/setup.ts";

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const [fixtureSource, seedSource] = await Promise.all([
  readFile(new URL("../examples/default-workspace.json", import.meta.url), "utf8"),
  readFile(new URL("../examples/default-workspace.seed.sql", import.meta.url), "utf8"),
]);
const fixture = JSON.stringify(JSON.parse(fixtureSource));

await setupDatabase(databaseUrl);
const database = new Database(databaseUrl);
try {
  await database.transaction(async (sql) => {
    await sql`SELECT set_config('vibe_prompting.example_workspace_fixture', ${fixture}, true)`;
    await sql.unsafe(seedSource).simple();
  });
} finally {
  await database.close();
}

process.stdout.write("Seeded the default workspace example for the most recently active member.\n");
