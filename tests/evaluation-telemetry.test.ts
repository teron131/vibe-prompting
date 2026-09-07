/** Verifies telemetry disposal against real OpenTelemetry providers while replacing only the external Langfuse client. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { LangfuseClient } from "@langfuse/client";
import { ProxyTracerProvider, trace } from "@opentelemetry/api";
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
  assert.equal(activeProvider(), telemetry);
  const close = runner.close();
  assert.equal(runner.close(), close);
  release();
  await close;
  assert.notEqual(activeProvider(), telemetry);
  const replacement = new NodeTracerProvider();
  const next = new LangfuseExperimentRunner({ telemetry: replacement, client: client() });
  next.startTracing();
  assert.equal(activeProvider(), replacement);
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
  assert.equal(activeProvider(), host);
  trace.disable();
  await host.shutdown();
});

function client(): LangfuseClient {
  return { shutdown: async () => undefined } as unknown as LangfuseClient;
}

function activeProvider() {
  const provider = trace.getTracerProvider();
  return provider instanceof ProxyTracerProvider ? provider.getDelegate() : provider;
}
