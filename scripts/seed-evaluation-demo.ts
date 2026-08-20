/** Re-runs the default idempotent demo-data initializer against the configured application database. */

import { createDatabase } from "../src/vibe-prompting/database.ts";
import { ensureEvaluationDemo } from "../src/vibe-prompting/evaluation/demo.ts";

const database = createDatabase();
try {
  await database.initialize();
  const result = await ensureEvaluationDemo(database);
  console.log(
    `Ensured ${result.runCount} synthetic runs and ${result.caseCount} synthetic cases with ${result.modelId}.`,
  );
} finally {
  await database.close();
}
