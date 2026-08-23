/** Manually materializes one captured product example into an otherwise empty workspace database. */

import type postgres from "postgres";

import { Database, type DatabaseClient } from "../database/index.ts";
import type { Criterion } from "../evaluation/api.ts";
import capture from "./capture.json" with { type: "json" };

const CRITERIA_PROFILE_ID = "50000000-0000-4000-8000-000000000003";
const OBSOLETE_PROFILE_IDS = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
] as const;
const DEFAULT_CRITERIA: Criterion[] = [
  {
    instruction: "Language gate — Respond clearly in the same language used by the requester.",
    type: "boolean",
  },
  {
    instruction:
      "Intention gate — Complete supported work, decline only unsupported parts, and avoid unnecessary scope expansion.",
    type: "boolean",
  },
  {
    categories: ["fail", "partial", "pass"],
    instruction:
      "Tool usage check — Use relevant tools and persisted evidence when the request requires them; never invent a successful action.",
    type: "categorical",
  },
  {
    categories: ["bad", "decent", "good"],
    instruction:
      "Response quality — Produce a correct, grounded, concise, practical, and directly useful final answer.",
    type: "categorical",
  },
];

type DefaultExampleState = {
  hasCustomProfiles: boolean;
  hasWorkspaceData: boolean;
};

const actorEmail = process.argv[2]?.trim();
if (!actorEmail) {
  throw new Error("Usage: pnpm run db:seed-examples -- <active-user-email>");
}

const database = new Database();
await database.initialize();
try {
  const actorUserId = await readActorUserId(database, actorEmail);
  const seeded = await seedDefaultExamples(database, actorUserId);
  console.log(
    seeded
      ? `Seeded the captured default example for ${actorEmail}.`
      : "Skipped the captured default example because workspace data already exists.",
  );
} finally {
  await database.close();
}

async function readActorUserId(database: Database, email: string): Promise<string> {
  const [actor] = await database.run(
    (sql) => sql<{ id: string }[]>`
    SELECT id
    FROM auth_users
    WHERE lower(email) = lower(${email}) AND membership_status = 'active'
  `,
  );
  if (!actor) throw new Error(`No active user exists for ${email}.`);
  return actor.id;
}

async function seedDefaultExamples(database: Database, actorUserId: string): Promise<boolean> {
  return database.transaction(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(1464556119)`;
    const state = await readDefaultExampleState(sql);
    if (state.hasWorkspaceData || state.hasCustomProfiles) return false;
    await seedCriteria(sql, actorUserId);
    await seedPrompt(sql, actorUserId);
    await seedTargetProfile(sql, actorUserId);
    await seedChat(sql, actorUserId);
    await seedTargetRuns(sql, actorUserId);
    await seedEvaluations(sql, actorUserId);
    return true;
  });
}

async function readDefaultExampleState(sql: DatabaseClient): Promise<DefaultExampleState> {
  const [state] = await sql<DefaultExampleState[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM prompts
        UNION ALL SELECT 1 FROM chats
        UNION ALL SELECT 1 FROM evaluation_runs
      ) AS "hasWorkspaceData",
      EXISTS (
        SELECT 1
        FROM evaluation_criteria_profiles
        WHERE id NOT IN (
          ${CRITERIA_PROFILE_ID},
          ${OBSOLETE_PROFILE_IDS[0]},
          ${OBSOLETE_PROFILE_IDS[1]}
        )
      ) AS "hasCustomProfiles"
  `;
  if (!state) throw new Error("Default example state query returned no record.");
  return state;
}

async function seedCriteria(sql: DatabaseClient, actorUserId: string): Promise<void> {
  await sql`
    DELETE FROM evaluation_criteria_profiles
    WHERE id IN (${OBSOLETE_PROFILE_IDS[0]}, ${OBSOLETE_PROFILE_IDS[1]})
  `;
  await sql`
    INSERT INTO evaluation_criteria_profiles (
      id, name, criteria_json, created_by_user_id, updated_by_user_id
    )
    VALUES (
      ${CRITERIA_PROFILE_ID}, 'DEFAULT — Quality gate',
      ${sql.json(DEFAULT_CRITERIA as unknown as postgres.JSONValue[])},
      ${actorUserId}, ${actorUserId}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      criteria_json = EXCLUDED.criteria_json,
      updated_by_user_id = EXCLUDED.updated_by_user_id
  `;
}

async function seedPrompt(sql: DatabaseClient, actorUserId: string): Promise<void> {
  const firstRevision = capture.promptRows[0];
  if (!firstRevision) throw new Error("The system example requires an initial prompt revision.");
  await sql`
    INSERT INTO prompts (id, title, active_revision_id, created_at, updated_at)
    VALUES (
      ${capture.prompt.id}, ${capture.prompt.title},
      ${capture.prompt.activeRevisionId}, ${firstRevision.createdAt},
      ${capture.prompt.updatedAt}
    )
  `;
  for (const revision of capture.promptRows) {
    await sql`
      INSERT INTO prompt_revisions (
        id, prompt_id, parent_revision_id, revision_number, markdown, change_request,
        author, created_at, created_by_user_id
      )
      VALUES (
        ${revision.id}, ${revision.promptId}, ${revision.parentRevisionId},
        ${revision.revisionNumber}, ${revision.markdown}, ${revision.changeRequest},
        ${revision.author}, ${revision.createdAt}, ${actorUserId}
      )
    `;
  }
}

async function seedTargetProfile(sql: DatabaseClient, actorUserId: string): Promise<void> {
  const first = capture.targetProfileRows[0];
  if (!first) throw new Error("The system example requires a Target profile.");
  await sql`
    INSERT INTO target_profiles (id, name, prompt_id, current_revision_id)
    VALUES (${first.id}, ${first.name}, ${first.promptId}, ${first.currentRevisionId})
  `;
  for (const revision of capture.targetProfileRows) {
    await sql`
      INSERT INTO target_profile_revisions (
        id, target_profile_id, parent_revision_id, revision_number, instructions,
        configuration, created_by_user_id
      )
      VALUES (
        ${revision.revisionId}, ${revision.id}, ${revision.parentRevisionId},
        ${revision.revisionNumber}, ${revision.instructions},
        ${sql.json(revision.configuration as postgres.JSONValue)}, ${actorUserId}
      )
    `;
  }
}

async function seedChat(sql: DatabaseClient, actorUserId: string): Promise<void> {
  const { chat, context, messages } = capture.chat;
  await sql`
    INSERT INTO chats (
      id, owner_user_id, title, icon, model_id, workspace_context_json, created_at, updated_at
    )
    VALUES (
      ${chat.id}, ${actorUserId}, ${chat.title}, ${chat.icon}, ${chat.modelId},
      ${sql.json(context as unknown as postgres.JSONValue)}, ${chat.createdAt}, ${chat.updatedAt}
    )
  `;
  for (const message of messages) {
    const textContent = message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
    await sql`
      INSERT INTO chat_messages (
        id, chat_id, role, parts_json, metadata_json, text_content, created_at
      )
      VALUES (
        ${message.id}, ${chat.id}, ${message.role},
        ${sql.json(message.parts as unknown as postgres.JSONValue[])},
        ${sql.json(message.metadata as postgres.JSONValue)}, ${textContent}, ${message.createdAt}
      )
    `;
  }
}

async function seedTargetRuns(sql: DatabaseClient, actorUserId: string): Promise<void> {
  const responseMessages = new Map(
    capture.targetTurnRows.map((turn) => [turn.id, turn.responseMessages]),
  );
  for (const run of capture.targetRuns) {
    await sql`
      INSERT INTO target_runs (
        id, prompt_id, prompt_revision_id, target_profile_id, target_profile_revision_id,
        target_model_id, reasoning_effort, effective_instructions_hash, source, chat_id,
        started_by_user_id, created_at, updated_at
      )
      VALUES (
        ${run.id}, ${run.promptId}, ${run.promptRevisionId}, ${run.targetProfileId},
        ${run.targetProfileRevisionId}, ${run.targetModelId}, ${run.reasoningEffort},
        ${run.effectiveInstructionsHash}, ${run.source}, ${run.chatId},
        ${actorUserId}, ${run.createdAt}, ${run.updatedAt}
      )
    `;
    for (const turn of run.turns) {
      await sql`
        INSERT INTO target_run_turns (
          id, run_id, position, input_text, output_text, response_messages_json, usage_json,
          activity_json, status, error_message, created_by_user_id, created_at, completed_at
        )
        VALUES (
          ${turn.id}, ${run.id}, ${turn.position}, ${turn.input}, ${turn.output},
          ${sql.json((responseMessages.get(turn.id) ?? []) as unknown as postgres.JSONValue[])},
          ${sql.json(turn.usage as postgres.JSONValue)},
          ${sql.json(turn.activity as unknown as postgres.JSONValue[])},
          ${turn.status}, ${turn.errorMessage}, ${actorUserId}, ${turn.createdAt},
          ${turn.completedAt}
        )
      `;
    }
  }
}

async function seedEvaluations(sql: DatabaseClient, actorUserId: string): Promise<void> {
  for (const run of capture.evaluations) {
    await sql`
      INSERT INTO evaluation_runs (
        id, prompt_id, prompt_revision_id, chat_id, source, target_model_id,
        judge_model_ids, status, configuration_fingerprint, error_message, created_at,
        completed_at, is_synthetic_example, started_by_user_id, target_profile_id,
        target_profile_revision_id, effective_instructions_hash, target_run_id,
        target_run_turn_id
      )
      VALUES (
        ${run.id}, ${run.promptId}, ${run.promptRevisionId}, ${run.chatId},
        ${run.source}, ${run.targetModelId}, ${sql.array([...run.judgeModelIds])},
        ${run.status}, ${run.configurationFingerprint}, ${run.errorMessage},
        ${run.createdAt}, ${run.completedAt}, true, ${actorUserId},
        ${run.targetProfileId}, ${run.targetProfileRevisionId},
        ${run.effectiveInstructionsHash}, ${run.targetRunId}, ${run.targetRunTurnId}
      )
    `;
    for (const evaluationCase of run.cases) {
      await sql`
        INSERT INTO evaluation_cases (
          id, run_id, position, input_json, criteria_json, output_json
        )
        VALUES (
          ${evaluationCase.id}, ${run.id}, ${evaluationCase.position},
          ${sql.json(evaluationCase.input as postgres.JSONValue)},
          ${sql.json(evaluationCase.criteria as unknown as postgres.JSONValue[])},
          ${sql.json(evaluationCase.output as postgres.JSONValue)}
        )
      `;
      for (const score of evaluationCase.scores) {
        await sql`
          INSERT INTO evaluation_scores (
            id, case_id, criterion_position, data_type, criterion_json, judge_model_id,
            value_json, comment, evidence_json
          )
          VALUES (
            ${score.id}, ${evaluationCase.id}, ${score.criterionPosition},
            ${score.dataType}, ${sql.json(score.criterion as unknown as postgres.JSONValue)},
            ${score.judgeModelId}, ${sql.json(score.value as postgres.JSONValue)},
            ${score.comment}, ${sql.json(score.evidence as unknown as postgres.JSONValue[])}
          )
        `;
      }
    }
  }
}
