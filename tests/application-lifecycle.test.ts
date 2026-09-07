/** Exercises public runtime startup, isolated adapters, failure cleanup, and shutdown ordering with storage and transport boundaries replaced. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { promisify } from "node:util";

import { loadRuntimeConfig } from "../src/vibe-prompting/config/index.ts";
import type { ApplicationServices } from "../src/vibe-prompting/server.ts";

const events: string[] = [];
const opened: ApplicationServices[] = [];
const failure = new Error("Storage initialization failed.");
let failAt: "none" | "initialize" | "recovery" = "none";
let databases = 0;

class TestDatabase {
  constructor() {
    databases += 1;
  }
  async initialize() {
    events.push("database-ready");
    if (failAt === "initialize") throw failure;
  }
  async close() {
    events.push("database-closed");
  }
  async run(operation: (sql: unknown) => Promise<unknown>) {
    return operation(this.sql);
  }
  async transaction(operation: (sql: unknown) => Promise<unknown>) {
    return operation(this.sql);
  }
  readonly sql = async (parts: TemplateStringsArray) => {
    const statement = parts.join(" ");
    if (statement.includes("UPDATE target_run_turns") && failAt === "recovery") throw failure;
    if (statement.includes("UPDATE") && statement.includes("interrupted")) events.push("recovery");
    if (statement.includes("FOR UPDATE SKIP LOCKED")) events.push("claim");
    return [];
  };
}

class TestSettings {
  readonly #environment: NodeJS.ProcessEnv;
  constructor(_database: unknown, environment: NodeJS.ProcessEnv) {
    this.#environment = environment;
  }
  async initialize() {
    loadRuntimeConfig(this.#environment);
    events.push("settings-ready");
  }
  getRuntimeConfig() {
    return loadRuntimeConfig(this.#environment);
  }
}

class TestMcp {
  readModels!: () => Promise<string>;
  tool() {}
  resource(_options: unknown, read: () => Promise<string>) {
    this.readModels = read;
  }
  getContext() {
    return { http: true, auth: { claims: { actorUserId: "actor" } } };
  }
  async close() {
    events.push("mcp-closed");
  }
}

mock.module("../src/vibe-prompting/database/index.ts", {
  namedExports: { Database: TestDatabase },
});
mock.module("../src/vibe-prompting/settings/index.ts", {
  namedExports: { ApplicationSettingsStore: TestSettings },
});
mock.module("../src/vibe-prompting/clients/llm/models-dev.ts", {
  namedExports: {
    resolveModelIdentities: async (ids: string[]) =>
      ids.map((id) => ({ provider: "test", label: id, known: true })),
    resolveModelCatalogId: async (id: string) => id,
  },
});
mock.module("@prefecthq/fastmcp-ts/server", { namedExports: { FastMCP: TestMcp } });

const { createApplicationServices } = await import("../src/vibe-prompting/app/application.ts");
const { getApplicationServices, closeApplicationServices } =
  await import("../src/vibe-prompting/app/runtime.ts");
const { createApiServer } = await import("../src/vibe-prompting/app/api.ts");
const { createMcpServer, getMcpServer } = await import("../src/vibe-prompting/app/mcp.ts");

beforeEach(() => {
  events.length = 0;
  databases = 0;
  failAt = "none";
});
afterEach(async () => {
  for (const app of opened.splice(0)) await app.close().catch(() => undefined);
  await closeApplicationServices().catch(() => undefined);
});

test("initialization and recovery failures close the database without starting queues", async () => {
  for (const phase of ["initialize", "recovery"] as const) {
    failAt = phase;
    events.length = 0;
    await assert.rejects(
      createApplicationServices("test", { environment: environment("one") }),
      (error) => error === failure,
    );
    assert.equal(events.at(-1), "database-closed");
    assert.equal(events.includes("claim"), false);
  }
});

test("all recovery finishes before claims and shutdown waits for registered cleanup", async () => {
  const app = await open("one");
  await setImmediate();
  assert.equal(events.filter((event) => event === "recovery").length, 3);
  assert.ok(events.lastIndexOf("recovery") < events.indexOf("claim"));
  let release!: () => void;
  app.onClose(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const close = app.close();
  assert.equal(app.close(), close);
  await setImmediate();
  assert.equal(app.models.signal.aborted, true);
  assert.equal(events.includes("database-closed"), false);
  release();
  await close;
  assert.equal(events.at(-1), "database-closed");
  await assert.rejects(app.evaluations.startHumanRun("actor", {}), /closed/);
});

test("a cleanup error still closes other resources and storage", async () => {
  const app = await open("one");
  app.onClose(async () => {
    throw failure;
  });
  await assert.rejects(app.close(), AggregateError);
  assert.equal(events.at(-1), "database-closed");
  assert.equal(app.closed, true);
});

test("HTTP and MCP use injected settings without creating another application", async () => {
  const app = await open("chosen-model");
  const server = await createApiServer(app);
  const response = await server.inject({ method: "GET", url: "/api/config" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().models[0].id, "chosen-model");
  const mcp = createMcpServer(app) as unknown as TestMcp;
  assert.equal(JSON.parse(await mcp.readModels()).models[0].id, "chosen-model");
  assert.equal(databases, 1);
  await server.close();
  assert.equal(app.closed, false);
  await app.close();
  assert.ok(events.indexOf("mcp-closed") < events.indexOf("database-closed"));
});

test("a failed singleton retries once, concurrent callers share it, and closed instances are replaced", async () => {
  const previous = process.env.MODEL_CONFIG_YAML;
  process.env.MODEL_CONFIG_YAML = environment("shared").MODEL_CONFIG_YAML;
  try {
    failAt = "initialize";
    await assert.rejects(getApplicationServices(), (error) => error === failure);
    failAt = "none";
    const apps = await Promise.all(Array.from({ length: 8 }, () => getApplicationServices()));
    assert.ok(apps.every((app) => app === apps[0]));
    assert.equal(databases, 2);
    const oldMcp = await getMcpServer();
    await apps[0]!.close();
    const replacement = await getApplicationServices();
    assert.notEqual(replacement, apps[0]);
    assert.notEqual(await getMcpServer(), oldMcp);
    assert.equal(databases, 3);
  } finally {
    if (previous === undefined) delete process.env.MODEL_CONFIG_YAML;
    else process.env.MODEL_CONFIG_YAML = previous;
  }
});

test("signal shutdown waits for cleanup and rejects runtime recreation before exiting", async () => {
  const script = `
    import assert from 'node:assert/strict';
    import {setTimeout} from 'node:timers/promises';
    import {registerShutdown,getApplicationServices} from './src/vibe-prompting/app/runtime.ts';
    registerShutdown(async () => {
      await setTimeout(25);
      await assert.rejects(getApplicationServices(), error => error.statusCode === 503);
      console.log('cleanup-finished');
    }, true);
    process.kill(process.pid, 'SIGTERM');
    setTimeout(5).then(() => process.kill(process.pid, 'SIGTERM'));
    await setTimeout(1000);
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { timeout: 10_000 },
  );
  assert.equal(stdout.trim(), "cleanup-finished");
});

async function open(id: string) {
  const app = await createApplicationServices("test", { environment: environment(id) });
  opened.push(app);
  return app;
}

function environment(id: string): NodeJS.ProcessEnv {
  return {
    MODEL_CONFIG_YAML: JSON.stringify({
      models: [{ id, platform: "llm" }],
      helper_model: { id, platform: "llm" },
      embeddingModel: { id: "gemini-embedding-2", platform: "gemini" },
    }),
    LANGFUSE_PUBLIC_KEY: "",
    LANGFUSE_SECRET_KEY: "",
  };
}
