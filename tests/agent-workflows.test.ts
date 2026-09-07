/** Exercises workflow composition and failed-stream cleanup with the SDK runner replaced at its construction boundary. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

import type { AgentInputItem, RunStreamEvent } from "@openai/agents";

import type { ChatRunInput } from "../src/vibe-prompting/agents/openai-agents/chat.ts";
import type { AgentStreamEvent } from "../src/vibe-prompting/agents/openai-agents/events.ts";
import type { AgentTool } from "../src/vibe-prompting/agents/tools/api.ts";
let execute: (tools: AgentTool[], input: unknown) => Promise<ReturnType<typeof result>>;
const inputs: unknown[] = [];
mock.module("../src/vibe-prompting/agents/openai-agents/runtime.ts", {
  namedExports: {
    adaptTools: (tools: AgentTool[]) => tools,
    createAgentRuntime: (_id: string, tools: AgentTool[]) => ({
      model: { id: "model", platform: "llm" },
      agent: { tools },
      runner: {
        run: async (_agent: unknown, input: unknown) => {
          inputs.push(input);
          return execute(tools, input);
        },
      },
    }),
  },
});
const { streamChatRun } = await import("../src/vibe-prompting/agents/openai-agents/chat.ts");
const { streamPromptEdit } =
  await import("../src/vibe-prompting/agents/openai-agents/prompt-edit.ts");
after(() => mock.restoreAll());
beforeEach(() => {
  inputs.length = 0;
  execute = async () => result();
});
function result(events: RunStreamEvent[] = []) {
  return {
    state: {
      usage: { requests: 1, inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      addInput() {},
    },
    history: [] as AgentInputItem[],
    completed: Promise.resolve(),
    finalOutput: "Reply",
    error: undefined,
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}
function input(): ChatRunInput {
  return {
    modelId: "model",
    actorUserId: "actor",
    chatId: "chat",
    instruction: "New question",
    history: [{ role: "user", text: "Earlier question" }],
    attachments: [],
    enabledTools: [],
    reasoningEffort: "low",
    modelContext: {
      readConfig: () => ({ models: [{ id: "model" }] }),
      pricing: { estimate: () => ({ calculate: async () => null }) },
    },
  } as unknown as ChatRunInput;
}

test("prompt editing uses a fresh scope and keeps edits out of durable prompt storage", async () => {
  execute = async (tools) => {
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["read_prompt", "edit_prompt", "web_search_exa"],
    );
    const content = await tools[0]!.execute({}, {});
    assert.equal(typeof content, "string");
    const ref = String(content).split(":")[0]!;
    await tools[1]!.execute(
      { edits: [{ operation: "replace_range", startRef: ref, endRef: ref, lines: ["updated"] }] },
      {},
    );
    return result();
  };
  const original = {
    modelId: "model",
    markdown: "original",
    instruction: "Update",
    modelContext: input().modelContext,
  };
  assert.equal((await streamPromptEdit(original, () => {})).markdown, "updated");
  assert.equal((await streamPromptEdit(original, () => {})).markdown, "updated");
  assert.equal(original.markdown, "original");
});

test("chat projects history and attachments and disconnects steering when iteration fails", async () => {
  let disconnected = 0;
  execute = async () => ({
    ...result(),
    async *[Symbol.asyncIterator]() {
      yield* result();
      throw new Error("Stream failed");
    },
  });
  const request = input();
  request.attachments = [
    { name: "note.txt", mediaType: "text/plain", dataUrl: "data:text/plain;base64,aGk=", size: 2 },
    { name: "image.png", mediaType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 },
  ];
  request.steering = {
    connect: () => () => {
      disconnected++;
    },
    drain: () => [],
    retry() {},
    close: () => true,
  };
  await assert.rejects(
    streamChatRun(request, () => {}),
    /Stream failed/,
  );
  assert.equal(disconnected, 1);
  const serialized = JSON.stringify(inputs[0]);
  assert.match(serialized, /Earlier question/);
  assert.match(serialized, /Attached file note.txt/);
  assert.match(serialized, /input_image/);
});

test("late steering restarts the response and accumulates usage across both runs", async () => {
  const request = input();
  let drained = false;
  request.steering = {
    connect: () => () => {},
    drain: () => {
      if (drained) return [];
      drained = true;
      return ["Follow up"];
    },
    retry() {},
    close: () => true,
  };
  const events: AgentStreamEvent[] = [];
  const output = await streamChatRun(request, (event) => events.push(event));
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[1], [{ content: "Follow up", role: "user" }]);
  assert.equal(events.filter((event) => event.type === "response-reset").length, 1);
  assert.equal(output.telemetry.requests, 2);
  assert.equal(output.telemetry.totalTokens, 10);
});
