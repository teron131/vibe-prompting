/** Exercises conversation orchestration through its public commands with model and persistence boundaries controlled independently. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import type {
  ChatRunInput,
  ChatRunResult,
} from "../src/vibe-prompting/agents/openai-agents/chat.ts";
import type { AgentStreamEvent } from "../src/vibe-prompting/agents/openai-agents/events.ts";
import type { ChatMetadata } from "../src/vibe-prompting/conversations/metadata.ts";
import type {
  ChatRequest,
  Conversation,
  MessagePart,
  RunEvent,
} from "../src/vibe-prompting/conversations/schemas.ts";
import type { ConversationStore } from "../src/vibe-prompting/conversations/store.ts";

type Respond = (
  input: ChatRunInput,
  emit: (event: AgentStreamEvent) => void,
) => Promise<ChatRunResult>;
let respond: Respond;
let metadata: () => Promise<ChatMetadata | null>;
const calls: ChatRunInput[] = [];
let metadataCalls = 0;
mock.module("../src/vibe-prompting/agents/openai-agents/chat.ts", {
  namedExports: {
    streamChatRun: (input: ChatRunInput, emit: (event: AgentStreamEvent) => void) => {
      calls.push(input);
      return respond(input, emit);
    },
  },
});
mock.module("../src/vibe-prompting/conversations/metadata.ts", {
  namedExports: {
    generateChatMetadata: () => {
      metadataCalls++;
      return metadata();
    },
  },
});
const { ConversationService } = await import("../src/vibe-prompting/conversations/service.ts");
const opened: InstanceType<typeof ConversationService>[] = [];
beforeEach(() => {
  calls.length = 0;
  metadataCalls = 0;
  metadata = async () => ({ title: "Conversation", icon: "message-circle" });
  respond = async (_input, emit) => {
    emit({ type: "text-delta", delta: "Reply" });
    return result();
  };
});
afterEach(async () => {
  for (const service of opened.splice(0)) await service.close();
});
after(() => mock.restoreAll());

// The fake store enforces ownership; tests inspect the commands sent to it rather than emulate SQL guarantees.
function fixture() {
  let conversation: Conversation | undefined;
  let owner: string | undefined;
  const writes: string[] = [];
  const requireOwned = (actor: string) => {
    if (!conversation || actor !== owner)
      throw Object.assign(new Error("Chat not found."), { statusCode: 404 });
    return conversation;
  };
  type UserInput = Parameters<ConversationStore["createWithUserMessage"]>[1];
  const append = (actor: string, input: UserInput) => {
    assert.ok(input.chatId);
    const value = requireOwned(actor);
    value.context = input.context;
    value.messages.push({
      id: input.messageId,
      chatId: input.chatId,
      createdAt: new Date().toISOString(),
      metadata: {},
      role: "user",
      parts: [
        { type: "text", text: input.instruction },
        ...(input.attachments ?? []),
        ...(input.quotes ?? []),
      ],
    });
    return structuredClone(value);
  };
  const store = {
    async findConversation(actor: string) {
      if (!conversation) return null;
      return structuredClone(requireOwned(actor));
    },
    async requireChat(actor: string) {
      return requireOwned(actor).chat;
    },
    async getConversation(actor: string) {
      return structuredClone(requireOwned(actor));
    },
    async createWithUserMessage(actor: string, input: UserInput) {
      assert.ok(input.chatId);
      assert.equal(conversation, undefined);
      owner = actor;
      conversation = {
        chat: {
          id: input.chatId,
          title: input.instruction,
          icon: "message-circle",
          modelId: input.modelId,
          createdAt: "now",
          updatedAt: "now",
        },
        context: input.context,
        messages: [],
      };
      writes.push("create");
      return append(actor, input);
    },
    async appendUserMessage(actor: string, input: UserInput) {
      writes.push("append-user");
      return append(actor, input);
    },
    async replaceUserMessage(actor: string, input: UserInput & { replaceFromMessageId: string }) {
      const value = requireOwned(actor);
      const index = value.messages.findIndex(
        (message) => message.id === input.replaceFromMessageId,
      );
      assert(index >= 0);
      value.messages.splice(index);
      writes.push("replace");
      return append(actor, input);
    },
    async appendAssistantMessage(
      actor: string,
      input: { chatId: string; metadata: Record<string, unknown>; parts: MessagePart[] },
    ) {
      const value = requireOwned(actor);
      writes.push("assistant");
      value.messages.push({ id: randomUUID(), createdAt: "now", role: "assistant", ...input });
      return structuredClone(value);
    },
    async updateMetadata(actor: string, input: ChatMetadata) {
      const value = requireOwned(actor);
      writes.push("metadata");
      Object.assign(value.chat, input);
      return value.chat;
    },
    async deleteChat(actor: string) {
      requireOwned(actor);
      writes.push("delete");
      conversation = undefined;
    },
  } as unknown as ConversationStore;
  const contextId = randomUUID(),
    revisionId = randomUUID();
  const dependencies = {
    auth: {
      async requireActiveUser(actor: string) {
        if (actor === "pending")
          throw Object.assign(new Error("Active application membership is required."), {
            statusCode: 403,
          });
      },
    },
    modelContext: { readConfig: () => ({ models: [{ id: "model" }] }) },
    contexts: {
      async getContext() {
        return {
          id: contextId,
          revisionId,
          title: "Canonical context",
          markdown: "Exact quoted text",
        };
      },
      async getRevision() {
        return { markdown: "Exact quoted text" };
      },
    },
    targetRuns: {
      async getRun(_actor: string, runId: string) {
        return { id: runId, contextTitle: "Target", turns: [] };
      },
    },
  } as unknown as ConstructorParameters<typeof ConversationService>[1];
  const service = new ConversationService(store, dependencies);
  opened.push(service);
  return { service, store, writes, contextId, revisionId };
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    chatId: randomUUID(),
    messageId: randomUUID(),
    instruction: "Hello",
    modelId: "model",
    attachments: [],
    quotes: [],
    workspace: {
      activeContextId: null,
      enabledTools: [],
      panelOpen: false,
      reasoningEffort: "low",
    },
    ...overrides,
  };
}
function result(): ChatRunResult {
  return {
    message: "Reply",
    model: { id: "model", platform: "llm" },
    telemetry: {
      durationMs: 1,
      estimatedCostUsd: null,
      inputTokens: 1,
      outputTokens: 1,
      requests: 1,
      totalTokens: 2,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function pauseUntilStopped(): void {
  respond = async (input, emit) => {
    emit({ type: "text-delta", delta: "Working" });
    await new Promise<void>((_resolve, reject) => {
      if (input.signal?.aborted) reject(input.signal.reason);
      else
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true });
    });
    return result();
  };
}

test("send resolves pinned quotes and attachments, persists activity, and replays a completed reply", async () => {
  const { service, contextId, revisionId } = fixture();
  respond = async (_input, emit) => {
    emit({ type: "reasoning", summary: "Discarded attempt" });
    emit({ type: "response-reset" });
    emit({ type: "reasoning", summary: "Final reasoning" });
    emit({ type: "tool", callId: "tool", name: "read", state: "running" });
    emit({ type: "tool", callId: "tool", name: "read", state: "completed", output: "read result" });
    emit({ type: "context-revision", contextId, revisionId });
    emit({ type: "context-revision", contextId, revisionId });
    emit({ type: "text-delta", delta: "Reply" });
    return result();
  };
  const targetRunId = randomUUID();
  const input = request({
    quotes: [
      { contextId, revisionId, text: "Exact quoted text", title: "Untrusted title" },
      { runId: targetRunId, title: "Untrusted Target title" },
    ],
    attachments: [
      {
        dataUrl: "data:text/plain;base64,SGk=",
        mediaType: "text/plain",
        name: "note.txt",
        size: 2,
      },
    ],
    workspace: {
      activeContextId: contextId,
      enabledTools: ["context-library"],
      panelOpen: true,
      reasoningEffort: "high",
    },
  });
  const run = await service.send("owner", input);
  await run.completion;
  const events: RunEvent[] = [];
  run.subscribe((event) => events.push(event));
  assert.equal(events.at(-1)?.type, "finish");
  assert.match(calls[0]!.instruction, /Current context: Canonical context/);
  assert.match(calls[0]!.instruction, new RegExp(revisionId));
  assert.match(calls[0]!.instruction, new RegExp(targetRunId));
  assert.deepEqual(calls[0]!.attachments, input.attachments);
  assert.deepEqual(calls[0]!.history, []);
  const saved = await service.inspect("owner", input.chatId);
  assert.equal(saved.active, false);
  assert.equal(saved.conversation.messages.length, 2);
  const userParts = saved.conversation.messages[0]!.parts;
  assert.equal(userParts.find((part) => part.type === "context-quote")?.title, "Canonical context");
  assert.deepEqual(
    userParts.find((part) => part.type === "target-run-quote"),
    {
      runId: targetRunId,
      title: "Target",
      type: "target-run-quote",
    },
  );
  const assistant = saved.conversation.messages[1]!;
  assert.deepEqual(
    assistant.parts.map((part) => part.type),
    ["reasoning", "tool", "text", "context-revision"],
  );
  assert.deepEqual(assistant.parts[0], { type: "reasoning", summary: "Final reasoning" });
  assert.equal(assistant.metadata.activeContextRevisionId, revisionId);
  assert.deepEqual(assistant.metadata.telemetry, result().telemetry);
});

test("continuation and replacement preserve history selection and metadata cadence", async () => {
  const { service, writes } = fixture();
  const first = request();
  await (
    await service.send("owner", first)
  ).completion;
  const second = request({ chatId: first.chatId, instruction: "Continue" });
  await (
    await service.send("owner", second)
  ).completion;
  assert.deepEqual(calls[1]!.history, [
    { role: "user", text: "Hello" },
    { role: "assistant", text: "Reply" },
  ]);
  assert.equal(metadataCalls, 1);
  const third = request({ chatId: first.chatId });
  await (
    await service.send("owner", third)
  ).completion;
  assert.equal(metadataCalls, 2);
  await (
    await service.send("owner", {
      ...second,
      instruction: "Replacement",
      replaceFromMessageId: second.messageId,
    })
  ).completion;
  assert.equal(writes.filter((write) => write === "replace").length, 1);
  assert.equal(metadataCalls, 3);
  assert.equal((await service.inspect("owner", first.chatId)).conversation.messages.length, 4);
  assert.deepEqual(calls.at(-1)!.history, calls[1]!.history);
});

test("foreign and inactive callers cannot read, stop, steer, replace, or delete a live private chat", async () => {
  const { service, writes } = fixture();
  pauseUntilStopped();
  const input = request();
  const run = await service.send("owner", input);
  const before = [...writes];
  for (const operation of [
    () => service.inspect("foreign", input.chatId),
    () => service.stop("foreign", { chatId: input.chatId }),
    () => service.steer("foreign", input),
    () => service.delete("foreign", input.chatId),
    () => service.send("foreign", { ...input, replaceFromMessageId: input.messageId }),
  ])
    await assert.rejects(operation(), { statusCode: 404 });
  await assert.rejects(service.send("pending", request()), { statusCode: 403 });
  assert.deepEqual(writes, before);
  assert.equal(calls[0]!.signal?.aborted, false);
  await service.stop("owner", { chatId: input.chatId });
  await run.completion;
});

test("disconnect leaves work active and inspect replays buffered activity until persistence completes", async () => {
  const { service } = fixture();
  const gate = deferred<void>();
  respond = async (_input, emit) => {
    emit({ type: "text-delta", delta: "First" });
    await gate.promise;
    emit({ type: "text-delta", delta: " second" });
    return result();
  };
  const input = request();
  const run = await service.send("owner", input);
  const received: RunEvent[] = [];
  const unsubscribe = run.subscribe((event) => received.push(event));
  unsubscribe();
  const snapshot = await service.inspect("owner", input.chatId);
  assert.equal(snapshot.active, true);
  assert.deepEqual(snapshot.events, [{ type: "text-delta", delta: "First" }]);
  gate.resolve();
  await run.completion;
  assert.equal(calls[0]!.signal?.aborted, false);
  assert.equal(received.length, 1);
  assert.equal((await service.inspect("owner", input.chatId)).conversation.messages.length, 2);
});

test("steering reaches the active runtime and is persisted as a user turn", async () => {
  const { service } = fixture();
  pauseUntilStopped();
  const input = request();
  const run = await service.send("owner", input);
  const delivered: string[] = [];
  calls[0]!.steering!.connect((text) => {
    delivered.push(text);
    return true;
  });
  assert.deepEqual(
    await service.steer(
      "owner",
      request({ chatId: input.chatId, instruction: "Change direction" }),
    ),
    { accepted: true },
  );
  assert.deepEqual(delivered, ["Change direction"]);
  const saved = await service.inspect("owner", input.chatId);
  assert.deepEqual(saved.conversation.messages.at(-1)!.parts, [
    { type: "text", text: "Change direction" },
  ]);
  await service.stop("owner", { chatId: input.chatId });
  await run.completion;
  await assert.rejects(service.steer("owner", input), { statusCode: 409 });
});

test("delete aborts the run and waits for pending metadata before removing storage", async () => {
  const { service, writes } = fixture();
  pauseUntilStopped();
  const gate = deferred<ChatMetadata | null>();
  metadata = () => gate.promise;
  const input = request();
  const run = await service.send("owner", input);
  const deletion = service.delete("owner", input.chatId);
  await setImmediate();
  assert.equal(calls[0]!.signal?.aborted, true);
  assert.equal(writes.includes("delete"), false);
  gate.resolve({ title: "Finished metadata", icon: "message-circle" });
  await deletion;
  await run.completion;
  assert.deepEqual(writes.slice(-2), ["metadata", "delete"]);
  assert.equal(writes.includes("assistant"), false);
});

test("invalid input and stale quotes fail before storage or model effects", async () => {
  const { service, contextId, revisionId, writes } = fixture();
  for (const input of [
    request({ modelId: "unknown" }),
    request({ replaceFromMessageId: randomUUID() }),
    request({ quotes: [{ contextId, revisionId, title: "Context", text: "Not in revision" }] }),
    request({
      attachments: [
        {
          name: "large",
          mediaType: "text/plain",
          dataUrl: "data:text/plain,x",
          size: 9 * 1024 * 1024,
        },
      ],
    }),
  ])
    await assert.rejects(service.send("owner", input), { statusCode: 400 });
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test("shutdown waits for accepted preparation and rejects subsequent commands", async () => {
  const { service, store } = fixture();
  const gate = deferred<void>();
  const original = store.createWithUserMessage.bind(store);
  store.createWithUserMessage = async (...args) => {
    await gate.promise;
    return original(...args);
  };
  const pending = service.send("owner", request());
  await setImmediate();
  const rejected = assert.rejects(pending, /closed/);
  let closed = false;
  const closing = service.close();
  void closing.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  gate.resolve();
  await Promise.all([closing, rejected]);
  assert.deepEqual(calls, []);
  await assert.rejects(service.send("owner", request()), /closed/);
});

test("failed preparation releases the claim and provider failures remain safe terminal events", async () => {
  const { service, store } = fixture();
  const input = request();
  const create = store.createWithUserMessage.bind(store);
  store.createWithUserMessage = async () => {
    throw new Error("Storage unavailable");
  };
  await assert.rejects(service.send("owner", input), /Storage unavailable/);
  store.createWithUserMessage = create;
  respond = async () => {
    throw new Error("Private provider detail");
  };
  const run = await service.send("owner", input);
  await run.completion;
  const events: RunEvent[] = [];
  run.subscribe((event) => events.push(event));
  assert.deepEqual(events.at(-1), { type: "error", message: "The agent run failed." });
  assert.equal((await service.inspect("owner", input.chatId)).active, false);
  assert.equal((await service.inspect("owner", input.chatId)).conversation.messages.length, 1);
});
