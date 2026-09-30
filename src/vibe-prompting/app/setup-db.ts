/** Prepares the configured workspace database for local use. */

import "dotenv/config";
import { setupDatabase } from "../database/index.ts";

const created = await setupDatabase();
process.stdout.write(
  created
    ? "Created the workspace database and applied all migrations.\n"
    : "The workspace database exists and all migrations are current.\n",
);
