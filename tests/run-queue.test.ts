/** Exercises queue activation, capacity, cancellation, and shutdown races without model or database fixtures. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { RunQueue } from "../src/vibe-prompting/app/queue.ts";
import { ConversationRunRegistry } from "../src/vibe-prompting/conversations/runs.ts";
import { TargetRunRegistry } from "../src/vibe-prompting/target/runs/registry.ts";

test("queues stay idle until activated and never exceed their capacity", async () => {
  const waiting = ["one", "two", "three"];
  const active: string[] = [];
  const releases = new Map<string, () => void>();
  let claims = 0;
  const queue = new RunQueue({
    name: "test",
    concurrency: 2,
    async claim() {
      claims += 1;
      return waiting.shift();
    },
    async execute(id) {
      active.push(id);
      await new Promise<void>((resolve) => releases.set(id, resolve));
    },
  });
  queue.wake();
  await setImmediate();
  assert.equal(claims, 0);
  queue.start();
  queue.wake();
  await setImmediate();
  assert.deepEqual(active, ["one", "two"]);
  releases.get("one")!();
  await setImmediate();
  assert.deepEqual(active, ["one", "two", "three"]);
  releases.get("two")!();
  releases.get("three")!();
  await queue.close();
});

test("shutdown waits for a pending claim and aborts it before execution", async () => {
  const claimed = deferred<string | undefined>();
  let signal: AbortSignal | undefined;
  const cleanup = deferred<void>();
  const queue = new RunQueue({
    name: "test",
    concurrency: 1,
    claim: () => claimed.promise,
    async execute(_id, aborted) {
      signal = aborted;
      await cleanup.promise;
    },
  });
  queue.start();
  const close = queue.close();
  assert.equal(queue.close(), close);
  claimed.resolve("late");
  await setImmediate();
  assert.equal(signal?.aborted, true);
  let closed = false;
  void close.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  cleanup.resolve();
  await close;
  assert.throws(() => queue.prepare(async () => undefined), /closed/);
});

test("shutdown waits for accepted preparation without draining newly queued work", async () => {
  const prepared = deferred<void>();
  let claims = 0;
  const queue = new RunQueue({
    name: "test",
    concurrency: 1,
    async claim() {
      claims += 1;
      return undefined;
    },
    async execute() {},
  });
  const pending = queue.prepare(() => prepared.promise);
  const closing = queue.close();
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  prepared.resolve();
  await Promise.all([pending, closing]);
  assert.equal(claims, 0);
});

test("Target shutdown rejects waiting claims and preserves release ownership", async () => {
  const registry = new TargetRunRegistry(1);
  const active = registry.claim("active");
  const waiting = assert.rejects(registry.claimWhenAvailable("waiting"), { name: "AbortError" });
  registry.close();
  assert.equal(active.signal.aborted, true);
  assert.throws(() => registry.claim("later"), /closed/);
  active.release();
  await waiting;
  assert.equal(registry.snapshot("active").active, false);
});

test("conversation shutdown waits for started work and releases unused claims", async () => {
  const registry = new ConversationRunRegistry();
  const active = registry.claim("active");
  registry.claim("unused");
  const cleanup = deferred<void>();
  active.start(() => cleanup.promise);
  const close = registry.close();
  assert.equal(active.signal.aborted, true);
  assert.equal(registry.snapshot("unused").active, false);
  assert.throws(() => registry.claim("later"), /closed/);
  cleanup.resolve();
  await close;
  assert.equal(registry.snapshot("active").active, false);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
