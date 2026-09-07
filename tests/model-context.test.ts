/** Verifies that configuration, cached prices, and provider capacity belong to their runtime rather than the process. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { createModelContext } from "../src/vibe-prompting/clients/llm/context.ts";
import { loadRuntimeConfig } from "../src/vibe-prompting/config/index.ts";
import type { Database } from "../src/vibe-prompting/database/index.ts";

test("contexts isolate settings and database-backed prices for the same model", async () => {
  const first = createModelContext(() => configuration("first"), priceDatabase(10));
  const second = createModelContext(() => configuration("second"), priceDatabase(20));
  assert.equal(first.readConfig().helperModel.id, "first");
  assert.equal(second.readConfig().helperModel.id, "second");
  assert.equal((await first.pricing.resolve("same-model")).inputPricePerMillionTokens, 10);
  assert.equal((await second.pricing.resolve("same-model")).inputPricePerMillionTokens, 20);
  await first.close();
  assert.throws(() => first.readConfig(), /closed/);
  assert.equal(second.readConfig().helperModel.id, "second");
  assert.equal((await second.pricing.resolve("same-model")).inputPricePerMillionTokens, 20);
  await second.close();
});

test("closing capacity rejects waiters and waits for active calls to release", async () => {
  const context = createModelContext(() => configuration("model"));
  const active = await Promise.all(
    Array.from({ length: 10 }, () => context.spend.start({ id: "model", platform: "llm" })),
  );
  const waiter = assert.rejects(context.spend.start({ id: "model", platform: "llm" }), /closed/);
  const close = context.close();
  assert.equal(context.close(), close);
  assert.equal(context.signal.aborted, true);
  let closed = false;
  void close.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  active.forEach((call) => call.release());
  await Promise.all([close, waiter]);
  await assert.rejects(context.spend.start({ id: "model", platform: "llm" }), /closed/);
});

function configuration(id: string) {
  return loadRuntimeConfig({
    MODEL_CONFIG_YAML: JSON.stringify({
      models: [{ id, platform: "llm" }],
      helper_model: { id, platform: "llm" },
      embeddingModel: { id: "gemini-embedding-2", platform: "gemini" },
    }),
  });
}

function priceDatabase(price: number): Database {
  return {
    run: async () => [
      {
        modelId: "same-model",
        catalogId: "test/same-model",
        permaslug: "test/same-model",
        inputPricePerMillionTokens: price,
        outputPricePerMillionTokens: price * 2,
        fetchedAt: new Date(),
      },
    ],
  } as unknown as Database;
}
