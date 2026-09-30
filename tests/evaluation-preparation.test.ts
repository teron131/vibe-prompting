/** Locks persisted fingerprints, preparation-only effects, batch ordering, and completed-turn snapshots across ownership changes. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { EvaluationPreparation } from "../src/vibe-prompting/evaluation/runs/preparation.ts";

const contextId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const profileRevisionId = "33333333-3333-4333-8333-333333333333";
const targetRunId = "44444444-4444-4444-8444-444444444444";
const turnId = "55555555-5555-4555-8555-555555555555";
const criteria = [{ name: "Helpful", type: "boolean" as const, instruction: "Check helpfulness." }];
function fixture() {
  const pins: unknown[] = [];
  const profile = {
    id: "66666666-6666-4666-8666-666666666666",
    revisionId: profileRevisionId,
    configuration: { maxSteps: 4 },
  };
  const turns = [
    {
      id: "earlier",
      position: 0,
      status: "completed",
      input: "First question",
      output: "First answer",
    },
    {
      id: turnId,
      position: 1,
      status: "completed",
      input: "Second question",
      output: "Recorded answer",
    },
    {
      id: "later",
      position: 2,
      status: "completed",
      input: "Future question",
      output: "Future answer",
    },
  ];
  const dependencies = [
    { getContext: async () => ({ id: contextId, revisionId, activeRevisionId: revisionId }) },
    {
      resolveDefinition: async (input: unknown) => {
        pins.push(input);
        return { profile, effectiveInstructionsHash: "pinned-instructions" };
      },
    },
    {
      getRun: async () => ({
        id: targetRunId,
        contextId,
        contextRevisionId: revisionId,
        targetProfileId: profile.id,
        targetProfileRevisionId: profileRevisionId,
        targetConfiguration: profile.configuration,
        effectiveInstructionsHash: "pinned-instructions",
        targetModel: "target-a",
        turns,
      }),
    },
    {
      readConfig: () => ({
        models: ["target-a", "target-b", "judge-a", "judge-b"].map((id) => ({ id })),
      }),
    },
  ] as unknown as ConstructorParameters<typeof EvaluationPreparation>;
  return { preparation: new EvaluationPreparation(...dependencies), pins, turns };
}
function runInput() {
  return {
    contextId,
    contextRevisionId: revisionId,
    targetModel: "target-a",
    judgeModels: ["judge-b", "judge-a"],
    cases: [{ input: "Example", criteria }],
  };
}

test("preparation retains the committed fingerprint and ignores judge ordering only", async () => {
  const { preparation, pins } = fixture();
  const input = runInput();
  const prepared = await preparation.run("actor", input, "human", null);
  assert.equal(
    prepared.configurationFingerprint,
    "6434c8332b9b7269aa1cde0f07a8cb85ca11b9adafcfda53752a072045a08a4b",
  );
  assert.deepEqual(prepared.cases, input.cases);
  assert.equal(pins.length, 1);
  const reordered = await preparation.run(
    "actor",
    { ...input, judgeModels: ["judge-a", "judge-b"] },
    "ai",
    "chat",
  );
  assert.equal(reordered.configurationFingerprint, prepared.configurationFingerprint);
  assert.deepEqual(reordered.judgeModels, ["judge-a", "judge-b"]);
  const changed = await preparation.run(
    "actor",
    { ...input, cases: [{ input: "Different", criteria }] },
    "human",
    null,
  );
  assert.notEqual(changed.configurationFingerprint, prepared.configurationFingerprint);
});

test("batch preview and preparation preserve configuration, target, repetition ordering", async () => {
  const { preparation, pins } = fixture();
  const input = {
    contextId,
    contextRevisionId: revisionId,
    targetModels: ["target-b", "target-a"],
    judgeModels: ["judge-b", "judge-a"],
    configurations: [
      { id: "one", name: "First", criteria },
      { id: "two", name: "Second", criteria },
    ],
    cases: [{ input: "Example" }],
    repetitions: 2,
  };
  const preview = await preparation.preview(input);
  assert.equal(pins.length, 0);
  assert.deepEqual(
    preview.jobs.map((job) => job.id),
    [
      "one:target-b:1",
      "one:target-b:2",
      "one:target-a:1",
      "one:target-a:2",
      "two:target-b:1",
      "two:target-b:2",
      "two:target-a:1",
      "two:target-a:2",
    ],
  );
  assert.equal(preview.executionCount, 8);
  assert.equal(preview.targetCaseInvocations, 8);
  assert.equal(preview.judgeScoreDecisions, 16);
  const batch = await preparation.batch("actor", input, "ai", "chat");
  assert.deepEqual(batch.preview, preview);
  assert.equal(batch.records.length, 8);
  assert.deepEqual(
    batch.records.map((record) => record.targetModel),
    preview.jobs.map((job) => job.targetModel),
  );
  assert.ok(batch.records.every((record) => record.source === "ai" && record.chatId === "chat"));
});

test("recorded preparation freezes the selected turn without opening or re-pinning a Target", async () => {
  const { preparation, pins, turns } = fixture();
  const record = await preparation.recorded(
    "actor",
    { targetRunId, targetRunTurnId: turnId, judgeModels: ["judge-a"], criteria },
    "human",
    null,
  );
  assert.deepEqual(pins, []);
  assert.deepEqual(record.recordedOutputs, ["Recorded answer"]);
  assert.deepEqual(record.cases[0]!.input, {
    messages: [
      { content: "First question", role: "user" },
      { content: "First answer", role: "assistant" },
      { content: "Second question", role: "user" },
    ],
  });
  turns[1]!.status = "running";
  await assert.rejects(
    preparation.recorded(
      "actor",
      { targetRunId, targetRunTurnId: turnId, judgeModels: ["judge-a"], criteria },
      "human",
      null,
    ),
    /Only a completed/,
  );
});

test("invalid model and stale context fail before pinning any executable dependencies", async () => {
  const { preparation, pins } = fixture();
  await assert.rejects(
    preparation.run("actor", { ...runInput(), targetModel: "missing" }, "human", null),
    /not configured/,
  );
  await assert.rejects(
    preparation.run(
      "actor",
      { ...runInput(), contextRevisionId: profileRevisionId },
      "human",
      null,
    ),
    { statusCode: 409 },
  );
  assert.deepEqual(pins, []);
});
