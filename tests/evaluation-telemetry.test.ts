/** Verifies telemetry disposal against real OpenTelemetry providers while replacing only the external Langfuse client. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { LangfuseClient } from "@langfuse/client";
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { LangfuseExperimentRunner } from "../src/vibe-prompting/evaluation/experiments.ts";

test("closed evaluator telemetry can be replaced and disposal waits for the client", async () => {
  let release!: () => void;
  const telemetry = new NodeTracerProvider();
  const runner = new LangfuseExperimentRunner({
    telemetry,
    client: {
      shutdown: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    } as unknown as LangfuseClient,
  });
  runner.startTracing();
  assert.equal(trace.getTracer("test"), telemetry.getTracer("test"));
  const close = runner.close();
  assert.equal(runner.close(), close);
  release();
  await close;
  assert.notEqual(trace.getTracer("test"), telemetry.getTracer("test"));
  const replacement = new NodeTracerProvider();
  const next = new LangfuseExperimentRunner({ telemetry: replacement, client: client() });
  next.startTracing();
  assert.equal(trace.getTracer("test"), replacement.getTracer("test"));
  await next.close();
});

test("disposing an evaluator never unregisters another host's telemetry", async () => {
  const host = new NodeTracerProvider();
  host.register();
  const runner = new LangfuseExperimentRunner({
    telemetry: new NodeTracerProvider(),
    client: client(),
  });
  runner.startTracing();
  await runner.close();
  assert.equal(trace.getTracer("test"), host.getTracer("test"));
  trace.disable();
  await host.shutdown();
});

test("disposing an evaluator preserves telemetry registered while shutdown is pending", async () => {
  let release!: () => void;
  const runner = new LangfuseExperimentRunner({
    telemetry: new NodeTracerProvider(),
    client: {
      shutdown: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    } as unknown as LangfuseClient,
  });
  const host = new NodeTracerProvider();
  runner.startTracing();
  const close = runner.close();
  try {
    trace.disable();
    host.register();
    release();
    await close;
    assert.equal(trace.getTracer("test"), host.getTracer("test"));
  } finally {
    release();
    await close;
    trace.disable();
    await host.shutdown();
  }
});

function client(): LangfuseClient {
  return { shutdown: async () => undefined } as unknown as LangfuseClient;
}

test("canonical criteria retain Langfuse score names, data types, and Boolean conversion", async () => {
  let exported: unknown;
  const runner = new LangfuseExperimentRunner({
    telemetry: new NodeTracerProvider(),
    client: {
      experiment: {
        run: async (input: {
          data: Array<{ metadata: unknown }>;
          evaluators: Array<(input: { metadata: unknown }) => Promise<unknown>>;
        }) => {
          exported = await input.evaluators[0]!({ metadata: input.data[0]!.metadata });
        },
      },
      flush: async () => {},
      shutdown: async () => {},
    } as unknown as LangfuseClient,
  });
  try {
    await runner.persist({
      name: "canonical",
      cases: [
        {
          input: "question",
          output: "answer",
          criteria: [{ name: "Helpful", type: "boolean", instruction: "Check helpfulness." }],
          scores: [
            {
              criterionName: "Helpful",
              dataType: "BOOLEAN",
              judgeModel: "judge",
              value: true,
              comment: "Supported",
              evidence: ["answer"],
            },
          ],
        },
      ],
    });
    assert.deepEqual(exported, [
      {
        name: "Helpful@judge",
        dataType: "BOOLEAN",
        value: 1,
        comment: "Supported",
        metadata: {
          criterionName: "Helpful",
          criterion: "Check helpfulness.",
          judgeModel: "judge",
          evidence: ["answer"],
        },
      },
    ]);
  } finally {
    await runner.close();
  }
});
