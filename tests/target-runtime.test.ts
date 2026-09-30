/** Verifies Target runtime resource ownership with model and MCP dependencies replaced only at their external boundaries. */

import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

import { createModelContext } from "../src/vibe-prompting/clients/llm/context.ts";
import { loadRuntimeConfig } from "../src/vibe-prompting/config/index.ts";
import type { PinnedTargetDefinition } from "../src/vibe-prompting/target/schemas.ts";

type Failure = "none" | "discovery" | "missing-tool" | "adaptation" | "runtime";

let failure: Failure = "none";
let connections = 0;
let closes = 0;
const initializationError = new Error("Target initialization failed.");
const target = { model: "fake-model", invoke: async () => "output" };
const runtime = { target, run: async () => ({ output: "output" }) };
let runtimeInput: Record<string, unknown> | undefined;

mock.module("@ai-sdk/mcp", {
  namedExports: {
    async createMCPClient() {
      connections += 1;
      return {
        async listTools() {
          if (failure === "discovery") throw initializationError;
          return {
            tools:
              failure === "missing-tool" ? [] : [{ name: "web_search_exa" }, { name: "other" }],
          };
        },
        toolsFromDefinitions(definitions: { tools: Array<{ name: string }> }) {
          assert.deepEqual(
            definitions.tools.map(({ name }) => name),
            ["web_search_exa"],
          );
          if (failure === "adaptation") throw initializationError;
          return { web_search_exa: {} };
        },
        async close() {
          closes += 1;
        },
      };
    },
  },
});
mock.module("../src/vibe-prompting/agents/ai-sdk/model.ts", {
  namedExports: {
    createModel: () => ({ modelId: "fake-model" }),
    createReasoningProviderOptions: () => ({ provider: { effort: "high" } }),
  },
});
mock.module("../src/vibe-prompting/clients/exa.ts", {
  namedExports: {
    EXA_WEB_SEARCH_TOOL: "web_search_exa",
    getExaMcpConnection: () => ({ url: "https://example.test/mcp" }),
    searchExaWeb: async () => [],
  },
});
mock.module("../src/vibe-prompting/target/adapters/ai-sdk.ts", {
  namedExports: {
    createAiSdkTargetRuntime(input: Record<string, unknown>) {
      if (failure === "runtime") throw initializationError;
      runtimeInput = input;
      return runtime;
    },
  },
});

const { openTargetRuntime } = await import("../src/vibe-prompting/target/runtime.ts");
const models = createModelContext(() =>
  loadRuntimeConfig({
    MODEL_CONFIG_YAML: JSON.stringify({
      models: [{ id: "fake-model", platform: "llm" }],
      helper_model: { id: "fake-model", platform: "llm" },
      embeddingModel: { id: "gemini-embedding-2", platform: "gemini" },
    }),
  }),
);

beforeEach(() => {
  failure = "none";
  connections = 0;
  closes = 0;
  runtimeInput = undefined;
});
after(async () => {
  mock.restoreAll();
  await models.close();
});

const definition: PinnedTargetDefinition = {
  contextId: "context",
  contextRevisionId: "context-revision",
  targetModel: "fake-model",
  reasoningEffort: "high",
  profile: {
    id: "profile",
    revisionId: "profile-revision",
    name: "Profile",
    instructions: "Profile instructions.",
    configuration: { tools: ["web-search"] },
  },
  effectiveInstructions: "Profile instructions.\n\nContext.",
  effectiveInstructionsHash: "pinned-hash",
};

test("a runtime without configured tools does not open an MCP connection", async () => {
  const pinned = await openTargetRuntime(
    {
      ...definition,
      profile: { ...definition.profile, configuration: {} },
    },
    models,
  );
  assert.equal(pinned.target, target);
  assert.equal(connections, 0);
  await pinned.close();
  assert.equal(closes, 0);
});

test("a runtime uses the resolved definition and transfers connection ownership to close", async () => {
  const pinned = await openTargetRuntime(definition, models);
  assert.equal(pinned.profile, definition.profile);
  assert.equal(pinned.effectiveInstructionsHash, definition.effectiveInstructionsHash);
  assert.equal(runtimeInput?.instructions, definition.effectiveInstructions);
  assert.equal(runtimeInput?.configuration, definition.profile.configuration);
  assert.deepEqual(runtimeInput?.providerOptions, { provider: { effort: "high" } });
  assert.equal(connections, 1);
  assert.equal(closes, 0);
  await pinned.close();
  assert.equal(closes, 1);
});

test("every failure after connecting releases the MCP client", async () => {
  for (const phase of ["discovery", "missing-tool", "adaptation", "runtime"] as const) {
    failure = phase;
    const closesBefore = closes;
    await assert.rejects(openTargetRuntime(definition, models), (error) =>
      phase === "missing-tool"
        ? error instanceof Error && error.message === "Exa MCP does not expose: web_search_exa."
        : error === initializationError,
    );
    assert.equal(closes, closesBefore + 1, `${phase} releases its connection`);
  }
});
