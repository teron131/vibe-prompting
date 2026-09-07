/** Verifies signed Gemini tool continuation through the actual Agents SDK using an in-process fake HTTP transport. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  type AgentStreamEvent,
  projectEvent,
} from "../src/vibe-prompting/agents/openai-agents/events.ts";
import { createAgentRuntime } from "../src/vibe-prompting/agents/openai-agents/runtime.ts";
import { createModelContext } from "../src/vibe-prompting/clients/llm/context.ts";
import { loadRuntimeConfig } from "../src/vibe-prompting/config/index.ts";

test("Gemini's signed tool call survives streaming and the next model request", async () => {
  const configuration = loadRuntimeConfig({
    GEMINI_API_KEY: "test-key",
    MODEL_CONFIG_YAML: JSON.stringify({
      models: [{ id: "test-gemini", platform: "gemini" }],
      helper_model: { id: "test-gemini", platform: "gemini" },
      embeddingModel: { id: "gemini-embedding-2", platform: "gemini" },
    }),
  });
  configuration.platforms.gemini.baseURL = "http://sdk.test/v1";
  const context = createModelContext(() => configuration);
  const originalFetch = globalThis.fetch;
  let requests = 0,
    toolCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).hostname, "sdk.test");
    const body = await request.json();
    requests++;
    if (requests === 1)
      return stream(
        [
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "signed-call",
                type: "function",
                function: { name: "echo", arguments: '{"text":"ok"}' },
                extra_content: { google: { thought_signature: "signature-proof" } },
              },
            ],
          },
          {},
        ],
        "tool_calls",
      );
    assert.equal(requests, 2);
    const assistant = body.messages.find(
      (message: { tool_calls?: unknown[] }) => message.tool_calls?.length,
    );
    assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, "signature-proof");
    const output = body.messages.find((message: { role: string }) => message.role === "tool");
    assert.equal(output.content, "ok");
    return stream([{ role: "assistant", content: "Done" }, {}], "stop");
  };
  try {
    const runtime = createAgentRuntime(
      "test-gemini",
      [
        tool({
          name: "echo",
          description: "Echo text",
          parameters: z.object({ text: z.string() }),
          execute: async ({ text }) => {
            toolCalls++;
            return text;
          },
        }),
      ],
      "low",
      context,
    );
    const run = await runtime.runner.run(runtime.agent, "Echo ok, then answer.", {
      stream: true,
      maxTurns: 3,
    });
    const events: AgentStreamEvent[] = [];
    const names = new Map<string, string>();
    for await (const event of run) events.push(...projectEvent(event, names));
    await run.completed;
    assert.equal(run.error, null);
    assert.equal(run.finalOutput, "Done");
    assert.equal(requests, 2);
    assert.equal(toolCalls, 1);
    assert.deepEqual(
      events.filter((event) => event.type === "tool").map((event) => [event.name, event.state]),
      [
        ["echo", "running"],
        ["echo", "completed"],
      ],
    );
    assert.equal(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
      "Done",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await context.close();
  }
});
function stream(deltas: unknown[], finishReason: string): Response {
  const chunks = deltas.map((delta, index) => ({
    id: "completion",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-gemini",
    choices: [
      { index: 0, delta, finish_reason: index === deltas.length - 1 ? finishReason : null },
    ],
    ...(index === deltas.length - 1
      ? { usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }
      : {}),
  }));
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
