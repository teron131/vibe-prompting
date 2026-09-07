/** Verifies evaluator invocation ownership independently of model transport and scoring policy. */

import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { z } from "zod";

mock.module("../src/vibe-prompting/evaluation/engine/evaluators.ts", {
  namedExports: {
    judgeModelsSchema: z.array(z.string()).min(1),
    createJudgesGraph: () => async (state: { judgeModels: string[] }) => ({
      evaluations: state.judgeModels.map((model) => ({
        model,
        results: [
          { name: "rule", dataType: "BOOLEAN", value: true, comment: "Accepted.", evidence: [] },
        ],
      })),
    }),
  },
});
const { createEvaluationEngine } = await import("../src/vibe-prompting/evaluation/engine/graph.ts");
after(() => mock.restoreAll());

test("evaluator disposal rejects new work and waits for an accepted invocation", async () => {
  const engine = createEvaluationEngine(undefined, {});
  let start!: () => void;
  let respond!: (value: string) => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const response = new Promise<string>((resolve) => {
    respond = resolve;
  });
  const input = {
    target: {
      model: "opaque",
      invoke: async () => {
        start();
        return response;
      },
    },
    targetModel: "opaque",
    judgeModels: ["judge"],
    cases: [
      {
        input: "question",
        criteria: [{ name: "rule", type: "boolean" as const, instruction: "Check the output." }],
      },
    ],
  };
  const run = engine.invoke(input);
  await started;
  const close = engine.close();
  assert.equal(engine.close(), close);
  let closed = false;
  void close.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  await assert.rejects(engine.invoke(input), /closed/);
  respond("finished");
  assert.equal((await run).results[0]?.output, "finished");
  await close;
});

test("generated and recorded evaluation share attribution and restore input order after concurrent work", async () => {
  const { evaluate, evaluateRecorded } = await import("../src/vibe-prompting/evaluation/api.ts");
  const engine = createEvaluationEngine(undefined, {});
  const criteria = [{ name: "rule", type: "boolean" as const, instruction: "Check the output." }];
  let calls = 0;
  let release!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const target = {
    model: "opaque",
    invoke: async (input: string) => {
      calls++;
      if (input === "first") await secondStarted;
      else release();
      return input + " output";
    },
  };
  try {
    const generated = await evaluate(
      target,
      {
        cases: [
          { input: "first", criteria },
          { input: "second", criteria },
        ],
        judgeModels: ["judge-a", "judge-b"],
      },
      { engine },
    );
    assert.deepEqual(
      generated.cases.map((item) => item.output),
      ["first output", "second output"],
    );
    const recorded = await evaluateRecorded(
      "opaque",
      {
        cases: generated.cases.map(({ input, output }) => ({ input, output, criteria })),
        judgeModels: ["judge-a", "judge-b"],
      },
      { engine },
    );
    assert.equal(calls, 2);
    assert.deepEqual(recorded, generated);
    assert.ok(
      recorded.cases.every(
        (item) =>
          item.evaluations[0]?.judgeModel === "judge-a" &&
          item.evaluations[1]?.judgeModel === "judge-b" &&
          item.evaluations[0]?.criterion.type === "boolean",
      ),
    );
  } finally {
    await engine.close();
  }
});
