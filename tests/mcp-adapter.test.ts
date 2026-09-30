/** Exercises real MCP HTTP dispatch, actor propagation, tool inventory, and artifact links without network or database effects. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ApplicationServices } from "../src/vibe-prompting/app/application.ts";
import { createMcpServer } from "../src/vibe-prompting/app/mcp.ts";

const actor = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";

test("MCP preserves tool coverage and authenticated actor scope through the real HTTP transport", async () => {
  const previousBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://app.example.test";
  let close!: () => Promise<void>;
  const calls: unknown[][] = [];
  const services = {
    onClose(operation: () => Promise<void>) {
      close = operation;
    },
    getConfiguredModels: async () => [
      { id: "model", label: "Model", provider: "test", known: true },
    ],
    contexts: {
      createContext: async (...args: unknown[]) => {
        calls.push(args);
        return {
          id,
          revisionId: id,
          activeRevisionId: id,
          title: "Context",
          markdown: "Text",
          revisionCount: 1,
          updatedAt: "now",
        };
      },
    },
    criterion: {},
    evaluations: {},
    evaluationResults: {},
    scenarios: {},
    targetRuns: {},
  } as unknown as ApplicationServices;
  const server = createMcpServer(services);
  const request = async (method: string, params: unknown, authenticated = true) => {
    const response = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      authenticated
        ? {
            authInfo: {
              token: "test-token",
              clientId: "test",
              scopes: ["workspace:read", "workspace:write"],
              extra: { actorUserId: actor },
            },
          }
        : undefined,
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    const data = response.headers.get("content-type")?.includes("text/event-stream")
      ? text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6)
      : text;
    return JSON.parse(data);
  };
  try {
    const list = await request("tools/list", {});
    const expected = Object.keys(
      JSON.parse(readFileSync(new URL("./fixtures/agent-tools.json", import.meta.url), "utf8")),
    )
      .filter((key) => !key.startsWith("context-edit/") && !key.startsWith("web-search/"))
      .map((key) => key.split("/")[1])
      .sort();
    assert.deepEqual(list.result.tools.map((tool: { name: string }) => tool.name).sort(), expected);
    const denied = await request(
      "tools/call",
      { name: "create_context", arguments: { title: "Context", markdown: "Text" } },
      false,
    );
    assert.equal(denied.result.isError, true);
    assert.equal(calls.length, 0);
    const created = await request("tools/call", {
      name: "create_context",
      arguments: { title: "Context", markdown: "Text", actorUserId: "spoofed" },
    });
    assert.notEqual(created.result.isError, true, JSON.stringify(created));
    assert.equal(calls[0]![0], actor);
    assert.match(
      JSON.stringify(created.result),
      new RegExp(`https://app.example.test/contexts/${id}`),
    );
    const models = await request("resources/read", { uri: "config://models" });
    assert.equal(JSON.parse(models.result.contents[0].text).models[0].id, "model");
  } finally {
    await close();
    if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBaseUrl;
  }
});
