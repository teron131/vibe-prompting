/** Verifies evaluator invocation ownership independently of model transport and scoring policy. */

import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { z } from "zod";

mock.module("../src/vibe-prompting/evaluation/engine/evaluators.ts", {
  namedExports: {
    judgeModelsSchema: z.array(z.string()).min(1),
    createJudgesGraph: () => async () => ({
      evaluations: [
        {
          model: "judge",
          results: [
            { name: "rule", dataType: "BOOLEAN", value: true, comment: "Accepted.", evidence: [] },
          ],
        },
      ],
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
        criteria: [
          { name: "rule", dataType: "BOOLEAN" as const, instruction: "Check the output." },
        ],
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
