/** Prepares the configured workspace database for local development or deployment setup. */

import "dotenv/config";
import { setupDatabase } from "../database.ts";

const created = await setupDatabase();
process.stdout.write(
  created
    ? "Created the workspace database and applied all migrations.\n"
    : "The workspace database exists and all migrations are current.\n",
);
