/** Owns the deterministic product-guidance fixtures that coexist with user records in the shared database. */

import { createHash } from "node:crypto";

import type postgres from "postgres";

import { loadRuntimeConfig } from "../config/runtime.ts";
import type { StoredMessagePart } from "../conversations/store.ts";
import type { Database } from "../database.ts";
import type { Criterion } from "./api.ts";

const PROMPT_ID = uuid("evaluation-demo-prompt");
const PROMPT_REVISION_ID = uuid("evaluation-demo-prompt-revision-0");
const TARGET_PROFILE_ID = uuid("evaluation-demo-target-profile");
const TARGET_REVISION_ID = uuid("evaluation-demo-target-revision");
const CHAT_ID = uuid("evaluation-demo-chat");
const USER_MESSAGE_ID = uuid("evaluation-demo-chat-user-message");
const ASSISTANT_MESSAGE_ID = uuid("evaluation-demo-chat-assistant-message");
const TARGET_RUN_ID = uuid("evaluation-demo-multiturn-target-run");
const TARGET_RUN_TURN_IDS = [0, 1, 2, 3, 4].map((position) =>
  uuid(`evaluation-demo-multiturn-target-turn-${position}`),
);
const LEGACY_SYNTHETIC_RUN_ID = "2f9a8425-b58a-4c5d-a229-6df4e838afba";
const PROMPT_TITLE = "Prompt and Evaluation Guide";
const PROMPT_MARKDOWN = `# Prompt and Evaluation Guide

Explain these product concepts in clear, neutral English.

## Prompts

Prompts are reusable Markdown instructions used across AI SDK agent runs. Saving a prompt creates a revision so later changes do not rewrite earlier work.

## Evaluations

Evaluations run a saved prompt revision against selected cases and criteria. Each completed run preserves its inputs, outputs, scores, and evidence for later comparison.`;

const LANGUAGE: Criterion = {
  instruction:
    "Language gate — Answer English input in English and Chinese input in written Traditional Chinese.",
  type: "boolean",
};
const INTENT: Criterion = {
  instruction:
    "Intention gate — Complete supported work, decline only unsupported parts, and avoid unnecessary scope expansion.",
  type: "boolean",
};
const TOOL_USAGE: Criterion = {
  categories: ["fail", "partial", "pass"],
  instruction:
    "Tool usage — Use relevant evidence and direct source links when the request requires external facts; never invent evidence.",
  type: "categorical",
};
const RESPONSE_QUALITY: Criterion = {
  categories: ["bad", "decent", "good"],
  instruction:
    "Response quality — Produce a correct, grounded, concise, practical, and directly actionable final answer.",
  type: "categorical",
};
const DEMO_CRITERIA_PROFILES = [
  {
    criteria: [LANGUAGE, INTENT],
    id: "50000000-0000-4000-8000-000000000001",
    name: "Language only",
  },
  {
    criteria: [TOOL_USAGE],
    id: "50000000-0000-4000-8000-000000000002",
    name: "Tool use only",
  },
  {
    criteria: [LANGUAGE, INTENT, TOOL_USAGE, RESPONSE_QUALITY],
    id: "50000000-0000-4000-8000-000000000003",
    name: "Full quality gate",
  },
] as const satisfies readonly { criteria: Criterion[]; id: string; name: string }[];
const DEMO_RUNS = [
  {
    criteria: [LANGUAGE, INTENT],
    input: "Explain how a saved prompt revision is reused in an AI SDK agent run.",
    output:
      "A saved prompt revision is an immutable Markdown snapshot. An AI SDK agent run can load that exact revision, which keeps the instructions stable and makes the result reproducible.",
  },
  {
    criteria: [TOOL_USAGE],
    input: "Explain when an evaluation should use an external tool.",
    output:
      "An evaluation should use an external tool only when the answer depends on information that is not already available in the prompt, case, or saved context.",
  },
  {
    criteria: [LANGUAGE, INTENT, TOOL_USAGE, RESPONSE_QUALITY],
    input: "Summarize what an evaluation run preserves for later comparison.",
    output:
      "An evaluation run preserves the selected prompt revision, cases, criteria, model configuration, outputs, scores, and supporting evidence so later comparisons use the same recorded facts.",
  },
] as const satisfies readonly { criteria: Criterion[]; input: string; output: string }[];

export type DemoSeedSummary = {
  caseCount: number;
  modelId: string;
  runCount: number;
};

/** Replaces only stable demo-owned rows so the fixture stays exact while all user-owned rows remain untouched. */
export async function ensureEvaluationDemo(database: Database): Promise<DemoSeedSummary> {
  const modelId = loadRuntimeConfig().models[0]?.id;
  if (!modelId) throw new Error("At least one model must be configured for demo data.");
  return database.transaction(async (sql) => {
    await sql`DELETE FROM evaluation_runs WHERE id = ${LEGACY_SYNTHETIC_RUN_ID}`;
    await sql`DELETE FROM chats WHERE id = ${CHAT_ID}`;
    await sql`DELETE FROM prompts WHERE id = ${PROMPT_ID}`;
    await seedCriteriaProfiles(sql);
    await seedPrompt(sql);
    await seedTarget(sql);
    await seedChat(sql, modelId);
    for (const [runIndex, run] of DEMO_RUNS.entries()) {
      await seedRun(sql, runIndex, run, modelId);
    }
    await seedMultiturnRun(sql, modelId);
    return { caseCount: DEMO_RUNS.length + 1, modelId, runCount: DEMO_RUNS.length + 1 };
  });
}

async function seedCriteriaProfiles(sql: postgres.TransactionSql): Promise<void> {
  for (const profile of DEMO_CRITERIA_PROFILES) {
    await sql`
      INSERT INTO evaluation_criteria_profiles (id, name, criteria_json)
      VALUES (
        ${profile.id}, ${profile.name},
        ${sql.json(profile.criteria as postgres.JSONValue[])}
      )
      ON CONFLICT DO NOTHING
    `;
  }
}

async function seedPrompt(sql: postgres.TransactionSql): Promise<void> {
  await sql`
    INSERT INTO prompts (id, title, current_revision_id, active_revision_id, created_at, updated_at)
    VALUES (${PROMPT_ID}, ${PROMPT_TITLE}, ${PROMPT_REVISION_ID}, ${PROMPT_REVISION_ID}, '2026-08-17T00:00:00Z', '2026-08-17T00:00:00Z')
  `;
  await sql`
    INSERT INTO prompt_revisions (
      id, prompt_id, parent_revision_id, revision_number, markdown, change_request, author, created_at
    )
    VALUES (
      ${PROMPT_REVISION_ID}, ${PROMPT_ID}, NULL, 1, ${PROMPT_MARKDOWN}, NULL, 'human', '2026-08-17T00:00:00Z'
    )
  `;
}

async function seedTarget(sql: postgres.TransactionSql): Promise<void> {
  await sql`
    INSERT INTO target_profiles (id, name, prompt_id, current_revision_id)
    VALUES (${TARGET_PROFILE_ID}, 'AI SDK agent', ${PROMPT_ID}, ${TARGET_REVISION_ID})
  `;
  await sql`
    INSERT INTO target_profile_revisions (
      id, target_profile_id, parent_revision_id, revision_number, instructions, configuration
    )
    VALUES (
      ${TARGET_REVISION_ID}, ${TARGET_PROFILE_ID}, NULL, 1, '', ${sql.json({})}
    )
  `;
}

async function seedChat(sql: postgres.TransactionSql, modelId: string): Promise<void> {
  const context = {
    activePromptId: PROMPT_ID,
    enabledTools: ["prompt-library", "evaluations", "web-search"],
    panelOpen: false,
    reasoningEffort: "medium",
  };
  await sql`
    INSERT INTO chats (
      id, title, icon, model_id, workspace_context_json, created_at, updated_at
    )
    VALUES (
      ${CHAT_ID}, 'Using prompts and evaluations', 'message-circle', ${modelId},
      ${sql.json(context)}, '2026-08-18T00:00:00Z', '2026-08-18T00:01:00Z'
    )
  `;
  await insertChatMessage(sql, {
    createdAt: "2026-08-18T00:00:00Z",
    id: USER_MESSAGE_ID,
    parts: [{ text: "How do prompts and evaluations work together?", type: "text" }],
    role: "user",
  });
  await insertChatMessage(sql, {
    createdAt: "2026-08-18T00:01:00Z",
    id: ASSISTANT_MESSAGE_ID,
    metadata: {
      activePromptId: PROMPT_ID,
      activePromptRevisionId: PROMPT_REVISION_ID,
      completedAt: "2026-08-18T00:01:00Z",
      enabledTools: ["prompt-library"],
      modelId,
      reasoningEffort: "medium",
    },
    parts: [
      {
        callId: "demo-list-prompts",
        input: {},
        name: "list_prompts",
        output: [{ id: PROMPT_ID, title: PROMPT_TITLE }],
        state: "completed",
        summary: "Listed the available prompt.",
        type: "tool",
      },
      {
        callId: "demo-read-prompt",
        input: { promptId: PROMPT_ID },
        name: "read_prompt",
        output: { markdown: PROMPT_MARKDOWN, revisionId: PROMPT_REVISION_ID },
        state: "completed",
        summary: "Read the saved prompt revision.",
        type: "tool",
      },
      {
        text: "Prompts provide reusable Markdown instructions to AI SDK agent runs. Evaluations pin a saved prompt revision, run selected cases, apply the chosen criteria, and preserve the resulting evidence and scores for comparison.",
        type: "text",
      },
    ],
    role: "assistant",
  });
}

async function insertChatMessage(
  sql: postgres.TransactionSql,
  input: {
    createdAt: string;
    id: string;
    metadata?: Record<string, unknown>;
    parts: StoredMessagePart[];
    role: "assistant" | "user";
  },
): Promise<void> {
  const textContent = input.parts
    .filter((part): part is Extract<StoredMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  await sql`
    INSERT INTO chat_messages (
      id, chat_id, role, parts_json, metadata_json, text_content, created_at
    )
    VALUES (
      ${input.id}, ${CHAT_ID}, ${input.role}, ${sql.json(input.parts as postgres.JSONValue[])},
      ${sql.json((input.metadata ?? {}) as postgres.JSONValue)}, ${textContent}, ${input.createdAt}
    )
  `;
}

async function seedRun(
  sql: postgres.TransactionSql,
  runIndex: number,
  run: (typeof DEMO_RUNS)[number],
  modelId: string,
): Promise<void> {
  const runId = uuid(`evaluation-demo-run-${runIndex}`);
  const caseId = uuid(`evaluation-demo-case-${runIndex}-0`);
  const createdAt = new Date(Date.UTC(2026, 7, 17 + runIndex));
  await sql`
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, source, target_model_id, judge_model_ids, status,
      configuration_fingerprint, error_message, created_at, completed_at, target_profile_id,
      target_profile_revision_id, effective_instructions_hash, is_synthetic_example
    )
    VALUES (
      ${runId}, ${PROMPT_ID}, ${PROMPT_REVISION_ID}, 'human', ${modelId}, ${sql.array([modelId])},
      'completed', ${fingerprint(runIndex)}, NULL, ${createdAt},
      ${new Date(createdAt.getTime() + 60_000)}, ${TARGET_PROFILE_ID}, ${TARGET_REVISION_ID},
      ${createHash("sha256").update(PROMPT_MARKDOWN).digest("hex")}, true
    )
  `;
  await sql`
    INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
    VALUES (
      ${caseId}, ${runId}, 0, ${sql.json({ prompt: run.input })},
      ${sql.json(run.criteria as unknown as postgres.JSONValue[])}, ${sql.json({ answer: run.output })}
    )
  `;
  for (const [criterionPosition, criterion] of run.criteria.entries()) {
    await sql`
      INSERT INTO evaluation_scores (
        id, case_id, criterion_position, data_type, criterion_json, judge_model_id,
        value_json, comment, evidence_json
      )
      VALUES (
        ${uuid(`evaluation-demo-score-${runIndex}-0-${criterionPosition}-${modelId}`)},
        ${caseId}, ${criterionPosition}, ${criterion.type.toUpperCase()},
        ${sql.json(criterion as unknown as postgres.JSONValue)}, ${modelId},
        ${sql.json(scoreValue(criterion) as postgres.JSONValue)},
        'The synthetic answer satisfies this criterion.', ${sql.json([run.output])}
      )
    `;
  }
}

/** Adds one linked five-turn trace so the result explorer always has honest long-conversation presentation data. */
async function seedMultiturnRun(sql: postgres.TransactionSql, modelId: string): Promise<void> {
  const createdAt = "2026-08-21T02:30:00Z";
  const completedAt = "2026-08-21T02:35:00Z";
  const turns = [
    {
      activity: [
        {
          summary:
            "Identified the durable prompt revision and evaluation record as the relevant product concepts.",
          type: "reasoning" as const,
        },
      ],
      completedAt: "2026-08-21T02:30:35Z",
      input: "I have a saved prompt. What exactly stays fixed when I test it?",
      output:
        "The test pins the exact prompt revision, target profile revision, model, case inputs, and criteria so later comparisons refer to the same configuration.",
    },
    {
      activity: [
        {
          callId: "demo-read-evaluation-run",
          input: { runId: "example-run" },
          name: "read_evaluation_run",
          output: { fields: ["promptRevisionId", "targetModelId", "criteria", "scores"] },
          state: "completed" as const,
          summary: "Inspected the persisted evaluation fields.",
          type: "tool" as const,
        },
      ],
      completedAt: "2026-08-21T02:31:40Z",
      input: "If I continue the conversation, does the next evaluation lose the earlier context?",
      output:
        "No. A recorded evaluation carries the completed user and assistant turns before the selected turn, then judges the selected response against that preserved trace.",
    },
    {
      activity: [
        {
          summary: "Confirmed that reasoning and tool records belong to the full trace.",
          type: "reasoning" as const,
        },
      ],
      completedAt: "2026-08-21T02:32:35Z",
      input: "Can reviewers inspect tool calls and reasoning activity for earlier turns?",
      output:
        "Yes. The full trace keeps each turn's visible response together with its recorded reasoning and tool activity, while the compact result stays focused on user and AI messages.",
    },
    {
      activity: [],
      completedAt: "2026-08-21T02:33:40Z",
      input: "Should a long trace render every historical message immediately?",
      output:
        "Not necessarily. It can preserve the beginning and the evaluated ending, collapse the middle by default, and let the reviewer reveal every omitted message on demand.",
    },
    {
      activity: [
        {
          summary: "Separated the compact scan view from the complete evidence view.",
          type: "reasoning" as const,
        },
        {
          callId: "demo-read-target-trace",
          input: { targetRunId: TARGET_RUN_ID },
          name: "read_target_run",
          output: { selectedTurn: 5, turnCount: 5 },
          state: "completed" as const,
          summary: "Loaded the complete five-turn Target Run.",
          type: "tool" as const,
        },
      ],
      completedAt,
      input: "How should I review this result without crowding the default results page?",
      output:
        "Keep the default view focused on the evaluated turn, the response, and a compact count of earlier context. Open the full trace when you need every turn, tool action, and attributed score together.",
    },
  ];
  const instructionsHash = createHash("sha256").update(PROMPT_MARKDOWN).digest("hex");
  await sql`
    INSERT INTO target_runs (
      id, prompt_id, prompt_revision_id, target_profile_id, target_profile_revision_id,
      target_model_id, reasoning_effort, effective_instructions_hash, source, chat_id,
      created_at, updated_at
    )
    VALUES (
      ${TARGET_RUN_ID}, ${PROMPT_ID}, ${PROMPT_REVISION_ID}, ${TARGET_PROFILE_ID},
      ${TARGET_REVISION_ID}, ${modelId}, 'medium', ${instructionsHash}, 'human', NULL,
      ${createdAt}, ${completedAt}
    )
  `;
  for (const [position, turn] of turns.entries()) {
    await sql`
      INSERT INTO target_run_turns (
        id, run_id, position, input_text, output_text, activity_json, usage_json, status,
        created_at, completed_at
      )
      VALUES (
        ${TARGET_RUN_TURN_IDS[position]}, ${TARGET_RUN_ID}, ${position}, ${turn.input},
        ${turn.output}, ${sql.json(turn.activity as postgres.JSONValue[])},
        ${sql.json({ inputTokens: 420 + position * 180, outputTokens: 74 + position * 11, totalTokens: 494 + position * 191 })},
        'completed', ${new Date(Date.parse(createdAt) + position * 60_000)}, ${turn.completedAt}
      )
    `;
  }

  const runId = uuid("evaluation-demo-multiturn-run");
  const caseId = uuid("evaluation-demo-multiturn-case");
  const criteria = [TOOL_USAGE, RESPONSE_QUALITY];
  const messages = turns.flatMap((turn, position) => [
    { content: turn.input, role: "user" as const },
    ...(position < turns.length - 1 ? [{ content: turn.output, role: "assistant" as const }] : []),
  ]);
  await sql`
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, source, target_model_id, judge_model_ids, status,
      configuration_fingerprint, error_message, created_at, completed_at, target_profile_id,
      target_profile_revision_id, effective_instructions_hash, is_synthetic_example,
      target_run_id, target_run_turn_id
    )
    VALUES (
      ${runId}, ${PROMPT_ID}, ${PROMPT_REVISION_ID}, 'human', ${modelId}, ${sql.array([modelId])},
      'completed', ${fingerprint(99)}, NULL, ${createdAt}, ${completedAt}, ${TARGET_PROFILE_ID},
      ${TARGET_REVISION_ID}, ${instructionsHash}, true, ${TARGET_RUN_ID}, ${TARGET_RUN_TURN_IDS[4]}
    )
  `;
  await sql`
    INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
    VALUES (
      ${caseId}, ${runId}, 0, ${sql.json({ messages })},
      ${sql.json(criteria as unknown as postgres.JSONValue[])}, ${sql.json(turns[4].output)}
    )
  `;
  for (const [criterionPosition, criterion] of criteria.entries()) {
    await sql`
      INSERT INTO evaluation_scores (
        id, case_id, criterion_position, data_type, criterion_json, judge_model_id,
        value_json, comment, evidence_json
      )
      VALUES (
        ${uuid(`evaluation-demo-multiturn-score-${criterionPosition}-${modelId}`)}, ${caseId},
        ${criterionPosition}, ${criterion.type.toUpperCase()},
        ${sql.json(criterion as unknown as postgres.JSONValue)}, ${modelId},
        ${sql.json(scoreValue(criterion) as postgres.JSONValue)},
        'The response preserves the evaluated turn while making the earlier conversation available as supporting evidence.',
        ${sql.json([turns[1].input, turns[4].input, turns[4].output])}
      )
    `;
  }
}

function scoreValue(criterion: Criterion): boolean | string {
  if (criterion.type === "boolean") return true;
  if (criterion.type === "categorical") return criterion.categories.at(-1) ?? "pass";
  throw new Error(`Unsupported demo criterion type: ${criterion.type}`);
}

function fingerprint(runIndex: number): string {
  return createHash("sha256").update(`evaluation-demo-fingerprint-${runIndex}`).digest("hex");
}

function uuid(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "a";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
