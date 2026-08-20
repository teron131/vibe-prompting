/** Seeds a deterministic, idempotent evaluation corpus large enough to exercise pagination, filters, typed aggregates, and safe query exploration. */

import { createHash } from "node:crypto";

import type postgres from "postgres";

import { loadRuntimeConfig } from "../src/vibe-prompting/config/runtime.ts";
import { createDatabase } from "../src/vibe-prompting/database.ts";

const RUN_COUNT = 126;
const CASES_PER_RUN = 9;
const PROMPT_ID = uuid("evaluation-demo-prompt");
const PROMPT_REVISION_IDS = [0, 1, 2].map((index) =>
  uuid(`evaluation-demo-prompt-revision-${index}`),
);
const TARGET_PROFILE_ID = uuid("evaluation-demo-target-profile");
const TARGET_REVISION_ID = uuid("evaluation-demo-target-revision");
const configuredDemoModelId = loadRuntimeConfig().models.find(
  ({ id }) => id === "gemini-3.7-flash",
)?.id;
if (!configuredDemoModelId)
  throw new Error("Gemini 3.7 Flash must be configured before seeding evaluation demo data.");
const DEMO_MODEL_ID = configuredDemoModelId;
const CRITERIA = [
  { instruction: "Uses the requested language", type: "boolean" },
  { instruction: "Fulfills the user's stated intention", type: "boolean" },
  {
    categories: ["none", "appropriate", "excessive"],
    instruction: "Uses tools proportionately",
    type: "categorical",
  },
  { instruction: "Overall response quality", max: 5, min: 1, type: "numeric" },
] as const;

const database = createDatabase();
try {
  await database.initialize();
  await database.transaction(async (sql) => {
    await removePreviousDemoRuns(sql);
    await seedPrompt(sql);
    await seedTarget(sql);
    for (let runIndex = 0; runIndex < RUN_COUNT; runIndex += 1) {
      await seedRun(sql, runIndex);
    }
  });
  console.log(
    `Seeded ${RUN_COUNT} synthetic runs and ${RUN_COUNT * CASES_PER_RUN} synthetic cases with ${DEMO_MODEL_ID}.`,
  );
} finally {
  await database.close();
}

/** Deletes only the stable run IDs owned by this fixture so repeated seeds cannot remove user evaluations. */
async function removePreviousDemoRuns(sql: postgres.TransactionSql): Promise<void> {
  const runIds = Array.from({ length: RUN_COUNT }, (_, runIndex) =>
    uuid(`evaluation-demo-run-${runIndex}`),
  );
  await sql`DELETE FROM evaluation_runs WHERE id = ANY(${sql.array(runIds)}::uuid[])`;
}

async function seedPrompt(sql: postgres.TransactionSql): Promise<void> {
  await sql`
    INSERT INTO prompts (id, title, current_revision_id, created_at, updated_at)
    VALUES (${PROMPT_ID}, 'Company Research Assistant', ${PROMPT_REVISION_IDS[2]}, '2026-07-01T00:00:00Z', '2026-08-12T00:00:00Z')
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, current_revision_id = EXCLUDED.current_revision_id, updated_at = EXCLUDED.updated_at
  `;
  for (const [index, revisionId] of PROMPT_REVISION_IDS.entries()) {
    await sql`
      INSERT INTO prompt_revisions (
        id, prompt_id, parent_revision_id, revision_number, markdown, change_request, author, created_at
      )
      VALUES (
        ${revisionId}, ${PROMPT_ID}, ${index ? PROMPT_REVISION_IDS[index - 1] : null}, ${index + 1},
        ${`# Company Research Assistant\n\nRevision ${index + 1} answers filing and company questions with concise evidence.`},
        ${index ? `Improve evaluation baseline revision ${index + 1}.` : null},
        ${index ? "ai" : "human"}, ${new Date(Date.UTC(2026, 6, 1 + index * 14))}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

async function seedTarget(sql: postgres.TransactionSql): Promise<void> {
  await sql`
    INSERT INTO target_profiles (id, name, prompt_id, current_revision_id, created_at, updated_at)
    VALUES (${TARGET_PROFILE_ID}, 'Balanced research target', ${PROMPT_ID}, ${TARGET_REVISION_ID}, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, current_revision_id = EXCLUDED.current_revision_id
  `;
  await sql`
    INSERT INTO target_profile_revisions (
      id, target_profile_id, parent_revision_id, revision_number, instructions, configuration, created_at
    )
    VALUES (
      ${TARGET_REVISION_ID}, ${TARGET_PROFILE_ID}, NULL, 1,
      'Answer the request directly, use tools only when needed, and cite evidence for company claims.',
      ${sql.json({ reasoningEffort: "medium", toolPolicy: "auto" })}, '2026-07-01T00:00:00Z'
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedRun(sql: postgres.TransactionSql, runIndex: number): Promise<void> {
  const runId = uuid(`evaluation-demo-run-${runIndex}`);
  const promptRevisionId = PROMPT_REVISION_IDS[runIndex % PROMPT_REVISION_IDS.length]!;
  const targetModelId = DEMO_MODEL_ID;
  const judgeModelIds = [DEMO_MODEL_ID];
  const status = runStatus(runIndex);
  const createdAt = new Date(Date.UTC(2026, 6, 1, runIndex * 8));
  const completedAt = status === "running" ? null : new Date(createdAt.getTime() + 12 * 60 * 1000);
  await sql`
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, source, target_model_id, judge_model_ids, status,
      configuration_fingerprint, error_message, created_at, completed_at, target_profile_id,
      target_profile_revision_id, effective_instructions_hash, is_synthetic_example
    )
    VALUES (
      ${runId}, ${PROMPT_ID}, ${promptRevisionId}, ${runIndex % 4 ? "human" : "ai"},
      ${targetModelId}, ${sql.array(judgeModelIds)}, ${status}, ${fingerprint(runIndex)},
      ${status === "failed" ? "Synthetic provider timeout." : status === "interrupted" ? "Synthetic worker restart." : null},
      ${createdAt}, ${completedAt}, ${TARGET_PROFILE_ID}, ${TARGET_REVISION_ID},
      ${createHash("sha256")
        .update(`effective-instructions-${runIndex % 3}`)
        .digest("hex")}, true
    )
    ON CONFLICT (id) DO NOTHING
  `;
  for (let caseIndex = 0; caseIndex < CASES_PER_RUN; caseIndex += 1) {
    await seedCase(sql, { caseIndex, judgeModelIds, runId, runIndex, status });
  }
}

async function seedCase(
  sql: postgres.TransactionSql,
  input: {
    caseIndex: number;
    judgeModelIds: string[];
    runId: string;
    runIndex: number;
    status: "completed" | "failed" | "interrupted" | "running";
  },
): Promise<void> {
  const caseId = uuid(`evaluation-demo-case-${input.runIndex}-${input.caseIndex}`);
  const company = (input.runIndex + input.caseIndex) % 4 === 0;
  const prompt = company
    ? `Summarize the company filing risk factors for case ${input.caseIndex + 1}.`
    : `Explain the requested research topic for case ${input.caseIndex + 1}.`;
  const output =
    input.status === "completed"
      ? {
          answer: company
            ? `The company filing highlights demand, execution, and regulatory risks for sample ${input.runIndex + 1}.`
            : `The research answer addresses sample ${input.runIndex + 1} with concise evidence.`,
          citations: [`filing-${(input.runIndex % 12) + 1}`],
        }
      : null;
  await sql`
    INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
    VALUES (
      ${caseId}, ${input.runId}, ${input.caseIndex}, ${sql.json({ prompt })},
      ${sql.json(CRITERIA as unknown as postgres.JSONValue[])},
      ${output ? sql.json(output) : null}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  if (input.status !== "completed") return;
  for (const judge of input.judgeModelIds) {
    for (const [criterionPosition, criterion] of CRITERIA.entries()) {
      const value = scoreValue(input.runIndex, input.caseIndex, criterionPosition);
      await sql`
        INSERT INTO evaluation_scores (
          id, case_id, criterion_position, data_type, criterion_json, judge_model_id,
          value_json, comment, evidence_json
        )
        VALUES (
          ${uuid(`evaluation-demo-score-${input.runIndex}-${input.caseIndex}-${criterionPosition}-${judge}`)},
          ${caseId}, ${criterionPosition}, ${criterion.type.toUpperCase()},
          ${sql.json(criterion as unknown as postgres.JSONValue)}, ${judge},
          ${sql.json(value as postgres.JSONValue)},
          ${`Synthetic ${criterion.type} judgment for case ${input.caseIndex + 1}.`},
          ${sql.json([`Evidence from output sample ${input.runIndex + 1}.`])}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }
}

function runStatus(runIndex: number): "completed" | "failed" | "interrupted" | "running" {
  if (runIndex < 114) return "completed";
  if (runIndex < 118) return "failed";
  if (runIndex < 122) return "interrupted";
  return "running";
}

function scoreValue(
  runIndex: number,
  caseIndex: number,
  criterionPosition: number,
): boolean | number | string {
  const seed = runIndex * 7 + caseIndex * 3;
  if (criterionPosition === 0) return seed % 11 !== 0;
  if (criterionPosition === 1) return seed % 7 !== 0;
  if (criterionPosition === 2)
    return seed % 9 === 0 ? "excessive" : seed % 5 === 0 ? "none" : "appropriate";
  return Number((2.4 + (seed % 27) / 10).toFixed(1));
}

function fingerprint(runIndex: number): string {
  return createHash("sha256")
    .update(`evaluation-demo-fingerprint-${runIndex % 9}`)
    .digest("hex");
}

/** Derives stable UUID-shaped fixture keys so rerunning the seed replaces only its own corpus. */
function uuid(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "a";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
