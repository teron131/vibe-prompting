/** Exercises multiuser ownership, optimistic concurrency, durable workflow pressure, and provider capacity against an explicitly disposable PostgreSQL database. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

import { generateText } from "ai";
import postgres from "postgres";

import type { ApplicationServices } from "../src/vibe-prompting/server.ts";

const MODEL_ID = "fake-model";
const PROVIDER_CAPACITY = 10;
const TEST_INVITATION_CODE = "multiuser-stress-invitation";
const TERMINAL_EVALUATION_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const TERMINAL_TARGET_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);

type ActiveUser = {
  id: string;
  token: string;
};

type TestSummary = {
  elapsedMs: number;
  users: { active: number; pending: number; sessions: number };
  chats: { created: number; acceptedMessages: number; rateLimitedMessages: number };
  conflicts: {
    prompts: number;
    targetProfiles: number;
    criteria: number;
    settings: number;
  };
  workflows: {
    evaluationStatuses: Record<string, number>;
    scenarioStatus: string;
    targetStatus: string;
    restartInterrupted: number;
  };
  provider: { calls: number; maxConcurrency: number };
  invariants: Record<string, number>;
};

type FakeProvider = {
  baseUrl: string;
  calls(): number;
  close(): Promise<void>;
  maxConcurrency(): number;
  requests(): Array<{ path: string; stream: boolean; structured: boolean; toolCount: number }>;
  reset(): void;
};

const startedAt = performance.now();
let services: ApplicationServices | undefined;
let restartedServices: ApplicationServices | undefined;
let fakeProvider: FakeProvider | undefined;
let restoreFetch: () => void = () => undefined;

try {
  const testDatabaseUrl = requireTestDatabaseUrl();
  fakeProvider = await startFakeProvider();
  configureTestEnvironment(testDatabaseUrl, fakeProvider.baseUrl);
  restoreFetch = installFakeGeminiEmbeddings();

  const { createApplicationServices } = await import("../src/vibe-prompting/server.ts");
  const { createModel: createAiSdkModel } =
    await import("../src/vibe-prompting/agents/ai-sdk/model.ts");
  const { streamChatRun } = await import("../src/vibe-prompting/agents/openai-agents/runtime.ts");
  const { createModel: createLangChainModel } =
    await import("../src/vibe-prompting/clients/llm/langchain.ts");
  const { evaluate } = await import("../src/vibe-prompting/index.ts");
  const standalone = await evaluate(
    { model: MODEL_ID, invoke: async () => "Standalone output." },
    {
      cases: [
        {
          input: "Standalone input.",
          criteria: [{ name: "Standalone", type: "boolean", instruction: "Check the response." }],
        },
      ],
      judgeModels: [MODEL_ID],
    },
  );
  assert.equal(standalone.cases[0]?.evaluations[0]?.value, true);

  await resetTestDatabase(testDatabaseUrl);
  services = await createApplicationServices(testDatabaseUrl);

  const { activeUsers, pendingUser, sessionCount } = await seedUsers(services);
  await exerciseTargetPinning(services, activeUsers[0]!.id, fakeProvider);
  await exerciseInvitationBoundary(services, activeUsers[0]!.id, pendingUser);
  await exerciseConversationService(services, activeUsers, testDatabaseUrl);
  const chatResult = await exerciseChatIsolationAndLimits(services, activeUsers, testDatabaseUrl);
  const conflictResult = await exerciseSharedConflicts(services, activeUsers);

  fakeProvider.reset();
  const pressureCalls: Array<Promise<unknown>> = [];
  for (let index = 0; index < 14; index += 1) {
    pressureCalls.push(
      generateText({
        model: createAiSdkModel(MODEL_ID, services.models),
        prompt: `Target capacity request ${index + 1}.`,
      }),
    );
  }
  for (let index = 0; index < 13; index += 1) {
    pressureCalls.push(
      createLangChainModel({ model: MODEL_ID, reasoningEffort: "low" }, services.models).invoke(
        `Helper capacity request ${index + 1}.`,
      ),
    );
  }
  for (let index = 0; index < 13; index += 1) {
    pressureCalls.push(
      streamChatRun(
        {
          actorUserId: activeUsers[index % activeUsers.length]!.id,
          modelContext: services.models,
          chatId: chatResult.chatIdsByUser[index % activeUsers.length]![0]!,
          instruction: `Chat capacity request ${index + 1}.`,
          history: [],
          attachments: [],
          modelId: MODEL_ID,
          reasoningEffort: "low",
          enabledTools: [],
          prompts: services.prompts,
          criterion: services.criterion,
          evaluations: services.evaluations,
          evaluationResults: services.evaluationResults,
          scenarios: services.scenarios,
          targetRuns: services.targetRuns,
        },
        () => undefined,
      ),
    );
  }
  await Promise.all(pressureCalls);
  assert.ok(fakeProvider.maxConcurrency() <= PROVIDER_CAPACITY);

  const workflowResult = await exerciseWorkflows(
    services,
    activeUsers,
    chatResult.chatIdsByUser[0]![0]!,
  );
  await exerciseCriteriaSnapshots(services, activeUsers[0]!.id);
  await exerciseEvaluationHistory(services, activeUsers[0]!.id, testDatabaseUrl);
  await exerciseGenerativeScenarios(services, activeUsers[0]!.id);
  await exerciseRuntimeShutdown(services, activeUsers[0]!.id, testDatabaseUrl);
  const restartResult = await exerciseRestartReconciliation(
    testDatabaseUrl,
    services,
    activeUsers[0]!.id,
  );
  restartedServices = restartResult.services;
  const invariants = await readInvariants(testDatabaseUrl);
  for (const [name, count] of Object.entries(invariants)) assert.equal(count, 0, name);

  const summary: TestSummary = {
    elapsedMs: Math.round(performance.now() - startedAt),
    users: { active: activeUsers.length, pending: pendingUser ? 1 : 0, sessions: sessionCount },
    chats: {
      created: chatResult.chatIdsByUser.flat().length,
      acceptedMessages: chatResult.acceptedMessages,
      rateLimitedMessages: chatResult.rateLimitedMessages,
    },
    conflicts: conflictResult,
    workflows: {
      evaluationStatuses: workflowResult.evaluationStatuses,
      scenarioStatus: workflowResult.scenarioStatus,
      targetStatus: workflowResult.targetStatus,
      restartInterrupted: restartResult.interrupted,
    },
    provider: { calls: fakeProvider.calls(), maxConcurrency: fakeProvider.maxConcurrency() },
    invariants,
  };
  console.log(JSON.stringify({ ok: true, summary }));
} catch (error) {
  process.exitCode = 1;
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
      elapsedMs: Math.round(performance.now() - startedAt),
      provider: fakeProvider
        ? {
            calls: fakeProvider.calls(),
            maxConcurrency: fakeProvider.maxConcurrency(),
            requests: fakeProvider.requests(),
          }
        : undefined,
    }),
  );
} finally {
  restoreFetch();
  await restartedServices?.close().catch(() => undefined);
  await services?.close().catch(() => undefined);
  await fakeProvider?.close().catch(() => undefined);
}

function requireTestDatabaseUrl(): string {
  const source = process.env.TEST_DATABASE_URL?.trim();
  if (!source) throw new Error("TEST_DATABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL.");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must name a database ending in _test.");
  }
  const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (
    applicationDatabaseUrl &&
    normalizeDatabaseUrl(applicationDatabaseUrl) === normalizeDatabaseUrl(source)
  ) {
    throw new Error("TEST_DATABASE_URL must not be identical to DATABASE_URL.");
  }
  return source;
}

function normalizeDatabaseUrl(source: string): string {
  const url = new URL(source);
  url.hash = "";
  return url.toString();
}

function configureTestEnvironment(testDatabaseUrl: string, providerBaseUrl: string): void {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.LLM_API_KEY = "multiuser-stress-test";
  process.env.LLM_BASE_URL = providerBaseUrl;
  process.env.GEMINI_API_KEY = "multiuser-stress-test";
  process.env.INVITATION_CODE = TEST_INVITATION_CODE;
  process.env.MODEL_CONFIG_YAML = [
    "models:",
    `  - id: ${MODEL_ID}`,
    "    platform: llm",
    "embeddingModel:",
    "  id: gemini-embedding-2",
    "  platform: gemini",
    "helper_model:",
    `  id: ${MODEL_ID}`,
    "  platform: llm",
  ].join("\n");
  delete process.env.MODEL_SPEND_LIMIT_USD;
  process.env.LANGFUSE_PUBLIC_KEY = "";
  process.env.LANGFUSE_SECRET_KEY = "";
}

function installFakeGeminiEmbeddings(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (
      !url.startsWith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
      )
    ) {
      return originalFetch(input, init);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { requests?: unknown[] };
    const embeddings = (body.requests ?? []).map((_request, index) => ({
      values: Array.from({ length: 768 }, (_value, dimension) =>
        dimension === index % 768 ? 1 : 0,
      ),
    }));
    return new Response(JSON.stringify({ embeddings }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function resetTestDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (transaction) => {
      await transaction`DROP SCHEMA public CASCADE`;
      await transaction`CREATE SCHEMA public`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function seedUsers(application: ApplicationServices): Promise<{
  activeUsers: ActiveUser[];
  pendingUser: ActiveUser;
  sessionCount: number;
}> {
  const activeUsers: ActiveUser[] = [];
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  for (let index = 0; index < 8; index += 1) {
    const user = await application.auth.upsertGoogleUser({
      googleSubject: `stress-active-${index + 1}`,
      email: `active-${index + 1}@example.test`,
      name: `Active User ${index + 1}`,
    });
    assert.equal(await application.auth.redeemInvitation(user.id, TEST_INVITATION_CODE), "active");
    const active = await application.auth.requireActiveUser(user.id);
    const token = await application.auth.createSession(active.id, expiresAt);
    const session = await application.auth.getSessionUser(token);
    assert.equal(session?.membershipStatus, "active");
    activeUsers.push({ id: active.id, token });
  }
  const pending = await application.auth.upsertGoogleUser({
    googleSubject: "stress-pending",
    email: "pending@example.test",
    name: "Pending User",
  });
  const pendingToken = await application.auth.createSession(pending.id, expiresAt);
  const pendingSession = await application.auth.getSessionUser(pendingToken);
  assert.equal(pendingSession?.membershipStatus, "pending");
  return {
    activeUsers,
    pendingUser: { id: pending.id, token: pendingToken },
    sessionCount: activeUsers.length + 1,
  };
}

async function exerciseInvitationBoundary(
  application: ApplicationServices,
  activeUserId: string,
  pendingUser: ActiveUser,
): Promise<void> {
  assert.equal((await application.auth.requireActiveUser(activeUserId)).id, activeUserId);
  await assertRejectsWithStatus(() => application.auth.requireActiveUser(pendingUser.id), 403);
  for (let attempt = 1; attempt < 5; attempt += 1) {
    assert.equal(await application.auth.redeemInvitation(pendingUser.id, "invalid"), "invalid");
  }
  assert.equal(await application.auth.redeemInvitation(pendingUser.id, "invalid"), "locked");
  assert.equal(
    await application.auth.redeemInvitation(pendingUser.id, TEST_INVITATION_CODE),
    "locked",
  );
  assert.equal(
    (await application.auth.getSessionUser(pendingUser.token))?.membershipStatus,
    "pending",
  );
}

/** Verifies the backend chat workflow against real PostgreSQL and the same fake SDK transport used by the stress harness. */
async function exerciseConversationService(
  application: ApplicationServices,
  users: ActiveUser[],
  databaseUrl: string,
): Promise<void> {
  const actor = users[0]!.id;
  const foreign = users[1]!.id;
  const chatId = randomUUID();
  const messageId = randomUUID();
  const input = {
    chatId,
    messageId,
    modelId: MODEL_ID,
    instruction: "Backend conversation smoke",
    attachments: [],
    quotes: [],
    workspace: { activePromptId: null, enabledTools: [], panelOpen: false, reasoningEffort: "low" },
  };
  const first = await application.conversations.send(actor, input);
  await first.completion;
  const events: Array<{ type: string }> = [];
  first.subscribe((event) => events.push(event));
  assert.equal(events.at(-1)?.type, "finish");
  const initial = await application.conversations.inspect(actor, chatId);
  assert.equal(initial.active, false);
  assert.equal(initial.conversation.messages.length, 2);
  assert.equal(
    initial.conversation.messages[1]?.parts.find((part) => part.type === "text")?.text,
    "Deterministic target output.",
  );
  for (const operation of [
    () => application.conversations.inspect(foreign, chatId),
    () => application.conversations.stop(foreign, { chatId }),
    () => application.conversations.steer(foreign, input),
    () => application.conversations.delete(foreign, chatId),
    () => application.conversations.send(foreign, { ...input, replaceFromMessageId: messageId }),
  ])
    await assert.rejects(operation(), { statusCode: 404 });
  const replacement = await application.conversations.send(actor, {
    ...input,
    instruction: "Replace the saved user message",
    replaceFromMessageId: messageId,
  });
  await replacement.completion;
  const replaced = await application.conversations.inspect(actor, chatId);
  assert.equal(replaced.conversation.messages.length, 2);
  assert.equal(replaced.conversation.messages[0]?.id, messageId);
  assert.deepEqual(replaced.conversation.messages[0]?.parts, [
    { type: "text", text: "Replace the saved user message" },
  ]);
  const next = await application.conversations.send(actor, {
    ...input,
    messageId: randomUUID(),
    instruction: "Continue the conversation",
  });
  await next.completion;
  assert.equal(
    (await application.conversations.inspect(actor, chatId)).conversation.messages.length,
    4,
  );
  assert.equal(
    (await application.conversations.listChats(actor, {})).chats.some((chat) => chat.id === chatId),
    true,
  );
  assert.equal(
    (await application.conversations.searchChats(foreign, "Backend conversation smoke")).some(
      (chat) => chat.id === chatId,
    ),
    false,
  );
  assert.deepEqual(await application.conversations.delete(actor, chatId), { deleted: true });
  await assert.rejects(application.conversations.inspect(actor, chatId), { statusCode: 404 });
  // Reset only the disposable harness's usage ledger before its exact 300-message quota test.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`DELETE FROM chat_usage_events`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function exerciseChatIsolationAndLimits(
  application: ApplicationServices,
  users: ActiveUser[],
  databaseUrl: string,
): Promise<{ chatIdsByUser: string[][]; acceptedMessages: number; rateLimitedMessages: number }> {
  const { Database } = await import("../src/vibe-prompting/database/index.ts");
  const { ConversationStore } = await import("../src/vibe-prompting/conversations/store.ts");
  const { ConversationRunRegistry } = await import("../src/vibe-prompting/conversations/runs.ts");
  const { HybridSearch } = await import("../src/vibe-prompting/search.ts");
  const database = new Database(databaseUrl);
  const store = new ConversationStore(
    database,
    new HybridSearch(database, application.models.readConfig),
  );
  const registry = new ConversationRunRegistry();
  try {
    const context = {
      activePromptId: null,
      enabledTools: ["prompt-library" as const, "evaluations" as const],
      panelOpen: false,
      reasoningEffort: "medium" as const,
    };
    const chatIdsByUser: string[][] = [];
    const initialMessageIds = new Map<string, string>();
    for (const [userIndex, user] of users.entries()) {
      const chatIds: string[] = [];
      for (let chatIndex = 0; chatIndex < 3; chatIndex += 1) {
        const chatId = randomUUID();
        const messageId = randomUUID();
        await store.createWithUserMessage(user.id, {
          chatId,
          context,
          instruction: `Shared searchable phrase for user ${userIndex + 1} chat ${chatIndex + 1}.`,
          messageId,
          modelId: MODEL_ID,
        });
        chatIds.push(chatId);
        initialMessageIds.set(chatId, messageId);
      }
      chatIdsByUser.push(chatIds);
    }

    for (const [userIndex, user] of users.entries()) {
      const expectedIds = new Set(chatIdsByUser[userIndex]);
      const listedIds = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await store.listChats(user.id, { cursor, limit: 2 });
        page.chats.forEach(({ id }) => listedIds.add(id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.deepEqual(
        listedIds,
        expectedIds,
        `Chat pagination leaked or skipped user ${userIndex + 1}.`,
      );
      const searched = await store.searchChats(user.id, "Shared searchable phrase");
      assert.deepEqual(
        new Set(searched.map(({ id }) => id)),
        expectedIds,
        `Chat search leaked or skipped user ${userIndex + 1}.`,
      );
    }

    const owner = users[0]!;
    const foreign = users[1]!;
    const privateChatId = chatIdsByUser[0]![0]!;
    const privateMessageId = initialMessageIds.get(privateChatId)!;
    const activeRun = registry.claim(privateChatId);
    activeRun.publish({ type: "reasoning-start" });
    const registryBefore = registry.snapshot(privateChatId);
    const foreignOperations = [
      () => store.getConversation(foreign.id, privateChatId),
      () => store.requireChat(foreign.id, privateChatId),
      () =>
        store.createWithUserMessage(foreign.id, {
          chatId: privateChatId,
          context,
          instruction: "Foreign create collision.",
          messageId: randomUUID(),
          modelId: MODEL_ID,
        }),
      () =>
        store.appendUserMessage(foreign.id, {
          chatId: privateChatId,
          context,
          instruction: "Foreign append.",
          messageId: randomUUID(),
          modelId: MODEL_ID,
        }),
      () =>
        store.replaceUserMessage(foreign.id, {
          chatId: privateChatId,
          context,
          instruction: "Foreign replacement.",
          messageId: privateMessageId,
          modelId: MODEL_ID,
          replaceFromMessageId: privateMessageId,
        }),
      () =>
        store.updateMetadata(foreign.id, {
          chatId: privateChatId,
          icon: "x",
          title: "Foreign",
        }),
      () => store.deleteChat(foreign.id, privateChatId),
    ];
    try {
      for (const operation of foreignOperations) await assertRejectsWithStatus(operation, 404);
      assert.deepEqual(registry.snapshot(privateChatId), registryBefore);
    } finally {
      activeRun.release();
    }
    assert.deepEqual(registry.snapshot(privateChatId), { active: false, events: [] });

    await store.replaceUserMessage(owner.id, {
      chatId: privateChatId,
      context,
      instruction: "Owner replacement with Shared searchable phrase.",
      messageId: privateMessageId,
      modelId: MODEL_ID,
      replaceFromMessageId: privateMessageId,
    });

    let acceptedMessages = 25;
    let rateLimitedMessages = 0;
    const remainingAttempts = 280;
    for (let offset = 0; offset < remainingAttempts; offset += 20) {
      const wave = Array.from({ length: Math.min(20, remainingAttempts - offset) }, (_, index) =>
        store.appendUserMessage(owner.id, {
          chatId: privateChatId,
          context,
          instruction: `Rate ledger message ${offset + index + 1}.`,
          messageId: randomUUID(),
          modelId: MODEL_ID,
        }),
      );
      const results = await Promise.allSettled(wave);
      for (const result of results) {
        if (result.status === "fulfilled") acceptedMessages += 1;
        else {
          assert.equal(readStatusCode(result.reason), 429);
          assert.ok(readRetryAfter(result.reason) > 0);
          rateLimitedMessages += 1;
        }
      }
    }
    assert.equal(acceptedMessages, 300);
    assert.equal(rateLimitedMessages, 5);
    return { chatIdsByUser, acceptedMessages, rateLimitedMessages };
  } finally {
    await registry.close();
    await database.close();
  }
}

/** Proves definition-only pinning, unchanged instruction hashes, and continuation across prompt/profile edits. */
async function exerciseTargetPinning(
  application: ApplicationServices,
  actorUserId: string,
  provider: FakeProvider,
): Promise<void> {
  const prompt = await application.prompts.createPrompt(actorUserId, {
    markdown: "Prompt one.\n",
    title: "Pinned definition",
  });
  const profile = await application.targets.createProfile(actorUserId, {
    configuration: { maxSteps: 1 },
    instructions: "Profile one.",
    name: "Pinned profile",
    promptId: prompt.id,
  });
  const input = {
    actorUserId,
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
  };
  const definition = await application.targets.resolveDefinition(input);
  assert.equal(definition.effectiveInstructions, "Profile one.\n\nPrompt one.\n");
  assert.equal(
    definition.effectiveInstructionsHash,
    "8b11ba3875e63e033e0411e9c82f59fbca01e90ebad472fa962e3098e86b7e21",
  );

  const launched = await application.targetRuns.startRunAndWait(actorUserId, {
    ...input,
    instruction: "First pinned turn.",
  });
  const firstTurn = await launched.completion;
  const evaluation = await application.evaluations.startHumanRun(actorUserId, {
    ...input,
    judgeModels: [MODEL_ID],
    cases: [
      { input: "Pinned case.", criteria: [{ name: "Pin", type: "boolean", instruction: "Pass." }] },
    ],
  });
  const completedEvaluation = await waitForEvaluation(application, actorUserId, evaluation.id);
  assert.equal(completedEvaluation.status, "completed");
  assert.equal(firstTurn.effectiveInstructionsHash, definition.effectiveInstructionsHash);
  assert.equal(completedEvaluation.effectiveInstructionsHash, definition.effectiveInstructionsHash);

  await application.prompts.appendHumanEdit(actorUserId, {
    promptId: prompt.id,
    markdown: "Prompt two.",
    expectedActiveRevisionId: prompt.revisionId,
  });
  const updatedProfile = await application.targets.appendProfileRevision(actorUserId, {
    profileId: profile.id,
    expectedRevisionId: profile.revisionId,
    instructions: "Profile two.",
    configuration: { tools: ["web-search"] },
  });
  const callsBeforePinning = provider.calls();
  const currentDefinition = await application.targets.resolveDefinition({
    ...input,
    targetModel: "definition-only-model",
  });
  assert.equal(currentDefinition.profile.revisionId, updatedProfile.revisionId);
  assert.equal(currentDefinition.effectiveInstructions, "Profile two.\n\nPrompt one.\n");
  assert.equal(provider.calls(), callsBeforePinning);
  const originalDefinition = await application.targets.resolveDefinition({
    ...input,
    targetProfileId: profile.id,
    targetProfileRevisionId: profile.revisionId,
  });
  assert.deepEqual(originalDefinition, definition);
  await assertRejectsWithStatus(
    () =>
      application.targets.resolveDefinition({
        ...input,
        targetProfileId: profile.id,
        targetProfileRevisionId: randomUUID(),
      }),
    404,
  );
  const continuation = await application.targetRuns.continueRunAndWait(actorUserId, firstTurn.id, {
    instruction: "Continue the original pins.",
  });
  const continued = await continuation.completion;
  assert.equal(continued.turns.length, 2);
  assert.ok(continued.turns.every(({ status }) => status === "completed"));
  assert.equal(continued.promptRevisionId, prompt.revisionId);
  assert.equal(continued.targetProfileRevisionId, profile.revisionId);
  assert.equal(continued.effectiveInstructionsHash, definition.effectiveInstructionsHash);
}

async function exerciseSharedConflicts(
  application: ApplicationServices,
  users: ActiveUser[],
): Promise<TestSummary["conflicts"]> {
  const prompt = await application.prompts.createPrompt(users[0]!.id, {
    markdown: "Prompt collision baseline.",
    title: "Prompt collision",
  });
  const promptResults = await Promise.allSettled(
    Array.from({ length: 32 }, (_, index) =>
      application.prompts.appendHumanEdit(users[index % users.length]!.id, {
        promptId: prompt.id,
        markdown: `Prompt collision winner ${index + 1}.`,
        expectedActiveRevisionId: prompt.activeRevisionId,
      }),
    ),
  );
  assertSettledCounts("prompt", promptResults, 1, 31, 409);
  const savedPrompt = await application.prompts.getPrompt(prompt.id);
  assert.equal(savedPrompt.revisionCount, 2);

  const targetProfile = await application.targets.createProfile(users[0]!.id, {
    configuration: {},
    instructions: "Target collision baseline.",
    name: "Target collision",
    promptId: prompt.id,
  });
  const targetResults = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) =>
      application.targets.appendProfileRevision(users[index % users.length]!.id, {
        configuration: {},
        expectedRevisionId: targetProfile.revisionId,
        instructions: `Target collision winner ${index + 1}.`,
        profileId: targetProfile.id,
      }),
    ),
  );
  assertSettledCounts("target profile", targetResults, 1, 15, 409);

  const criterion = await application.criterion.createCriterion(users[0]!.id, {
    name: "Determinism",
    type: "boolean",
    instruction: "The response is deterministic.",
  });
  const criteria = await application.criterion.createCriteria(users[0]!.id, {
    name: "Criteria collision",
    criterionIds: [criterion.id],
  });
  const criteriaResults = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) =>
      application.criterion.updateCriteria(
        users[index % users.length]!.id,
        criteria.id,
        criteria.version,
        {
          name: "Criteria collision",
          criterionIds: [criterion.id],
        },
      ),
    ),
  );
  assertSettledCounts("Criteria", criteriaResults, 1, 15, 409);

  const settings = application.settings.get();
  const settingsResults = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) =>
      application.settings.update(users[index % users.length]!.id, {
        expectedRevision: settings.revision,
        helperModel: settings.helperModel,
        models: settings.models,
        providers: [],
      }),
    ),
  );
  assertSettledCounts("settings", settingsResults, 1, 15, 409);
  return { prompts: 31, targetProfiles: 15, criteria: 15, settings: 15 };
}

async function exerciseWorkflows(
  application: ApplicationServices,
  users: ActiveUser[],
  producingChatId: string,
): Promise<{
  evaluationStatuses: Record<string, number>;
  scenarioStatus: string;
  targetStatus: string;
}> {
  const promptV1 = await application.prompts.createPrompt(users[0]!.id, {
    markdown: "Return a short deterministic response.",
    title: "Workflow pressure",
  });
  const targetRun = await application.targetRuns.startAgentRun(
    users[0]!.id,
    {
      instruction: "Generate the pinned response.",
      promptId: promptV1.id,
      promptRevisionId: promptV1.revisionId,
      reasoningEffort: "low",
      targetModel: MODEL_ID,
    },
    producingChatId,
  );
  const evaluation = await application.evaluations.startAgentRun(
    users[0]!.id,
    {
      promptId: promptV1.id,
      promptRevisionId: promptV1.revisionId,
      targetModel: MODEL_ID,
      judgeModels: [MODEL_ID],
      cases: [
        {
          input: "Evaluate the pinned response.",
          criteria: [
            { name: "Determinism", type: "boolean", instruction: "The response is deterministic." },
          ],
        },
      ],
      isSyntheticExample: false,
    },
    producingChatId,
  );
  await application.prompts.appendHumanEdit(users[1]!.id, {
    promptId: promptV1.id,
    markdown: "This is revision two and must not alter already pinned work.",
    expectedActiveRevisionId: promptV1.revisionId,
  });

  const completedTarget = await waitForTarget(application, users[0]!.id, targetRun.id);
  const completedEvaluation = await waitForEvaluation(application, users[0]!.id, evaluation.id);
  assert.equal(completedTarget.promptRevisionId, promptV1.revisionId);
  assert.equal(completedEvaluation.promptRevisionId, promptV1.revisionId);
  assert.equal(completedTarget.chatId, producingChatId);
  assert.equal(completedEvaluation.chatId, producingChatId);
  assert.equal((await application.targetRuns.getRun(users[1]!.id, targetRun.id)).chatId, null);
  assert.equal(
    (await application.evaluations.getRunSummary(users[1]!.id, evaluation.id)).chatId,
    null,
  );
  assert.equal(
    (await application.evaluationResults.getRun(users[1]!.id, evaluation.id)).chatId,
    null,
  );
  assert.equal(
    (await application.evaluationResults.getRun(users[0]!.id, evaluation.id)).chatId,
    producingChatId,
  );
  assert.ok(!("startedByUserId" in completedTarget));
  assert.ok(completedTarget.turns.every((turn) => !("createdByUserId" in turn)));
  assert.equal(completedTarget.startedByName, "Active User 1");
  assert.ok(!("startedByUserId" in completedEvaluation));
  assert.equal(completedEvaluation.startedByName, "Active User 1");

  const scenario = await application.scenarios.startAgentRun(
    users[0]!.id,
    {
      promptId: promptV1.id,
      promptRevisionId: promptV1.revisionId,
      targetModel: MODEL_ID,
      reasoningEffort: "low",
      mode: "static",
      messages: ["First deterministic turn.", "Second deterministic turn."],
      evaluationPlan: {
        configurations: [
          {
            name: "Scenario determinism",
            criteria: [
              {
                name: "Determinism",
                type: "boolean",
                instruction: "The response is deterministic.",
              },
            ],
          },
        ],
        judgeModels: [MODEL_ID],
      },
    },
    producingChatId,
  );
  const completedScenario = await waitForScenario(application, users[0]!.id, scenario.scenario.id);
  assert.equal(completedScenario.scenario.status, "completed");
  assert.equal(completedScenario.scenario.stopReason, "static-complete");
  assert.equal(completedScenario.target?.turns.length, 2);
  assert.deepEqual(
    completedScenario.target?.turns.map(({ input }) => input),
    ["First deterministic turn.", "Second deterministic turn."],
  );
  assert.equal(completedScenario.evaluations.length, 1);
  assert.equal(completedScenario.evaluations[0]?.status, "completed");
  assert.ok(!("targetRunId" in completedScenario.scenario));
  assert.ok(!("evaluationPlan" in completedScenario.scenario));

  const promptV2 = await application.prompts.getPrompt(promptV1.id);
  const batch = await application.evaluations.startHumanBatch(users[1]!.id, {
    promptId: promptV2.id,
    promptRevisionId: promptV2.revisionId,
    targetModels: [MODEL_ID],
    judgeModels: [MODEL_ID],
    configurations: Array.from({ length: 6 }, (_, index) => ({
      id: `configuration-${index + 1}`,
      name: `Configuration ${index + 1}`,
      criteria: [
        {
          name: `Deterministic check ${index + 1}`,
          type: "boolean" as const,
          instruction: `The response must satisfy deterministic check ${index + 1}.`,
        },
      ],
    })),
    cases: [{ input: "Produce one deterministic result." }],
    repetitions: 4,
    isSyntheticExample: false,
  });
  assert.equal(batch.runs.length, 24);
  await Promise.all(
    batch.runs.slice(0, 8).map(({ id }) => application.evaluations.cancel(users[2]!.id, id)),
  );
  const terminalRuns = await Promise.all(
    batch.runs.map(({ id }) => waitForEvaluation(application, users[0]!.id, id)),
  );
  const evaluationStatuses = countStatuses(terminalRuns.map(({ status }) => status));
  assert.equal(evaluationStatuses.completed, 16);
  assert.equal(evaluationStatuses.cancelled, 8);
  assert.equal(evaluationStatuses.failed ?? 0, 0);
  return {
    evaluationStatuses,
    scenarioStatus: completedScenario.scenario.status,
    targetStatus: completedTarget.latestStatus,
  };
}

/** Verifies shared rule updates and composition cascades without changing historical evaluation facts. */
async function exerciseCriteriaSnapshots(
  application: ApplicationServices,
  actorUserId: string,
): Promise<void> {
  const first = await application.criterion.createCriterion(actorUserId, {
    name: "Snapshot first",
    type: "boolean",
    instruction: "Original shared rule.",
  });
  const second = await application.criterion.createCriterion(actorUserId, {
    name: "Snapshot second",
    type: "boolean",
    instruction: "Surviving shared rule.",
  });
  const composition = await application.criterion.createCriteria(actorUserId, {
    name: "Snapshot composition",
    criterionIds: [first.id, second.id],
  });
  const emptied = await application.criterion.createCriteria(actorUserId, {
    name: "Single-rule composition",
    criterionIds: [first.id],
  });
  const prompt = await application.prompts.createPrompt(actorUserId, {
    title: "Criteria snapshots",
    markdown: "Return a deterministic response.",
  });
  const run = await application.evaluations.startHumanRun(actorUserId, {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
    judgeModels: [MODEL_ID],
    cases: [{ input: "Check the original rules.", criteria: composition.criterionSequence }],
  });
  assert.equal((await waitForEvaluation(application, actorUserId, run.id)).status, "completed");
  const original = await application.evaluationResults.getRun(actorUserId, run.id);
  const updated = await application.criterion.updateCriterion(
    actorUserId,
    first.id,
    first.version,
    {
      name: first.name,
      type: "boolean",
      instruction: "Updated shared rule for future runs.",
    },
  );
  const current = await application.criterion.getCriteria(composition.id);
  assert.deepEqual(
    current.criterionSequence.map(({ id }) => id),
    [first.id, second.id],
  );
  assert.equal(current.criterionSequence[0]?.instruction, updated.instruction);
  await assertRejectsWithStatus(
    () => application.criterion.deleteCriterion(actorUserId, first.id, first.version),
    409,
  );
  const deletion = await application.criterion.deleteCriterion(
    actorUserId,
    first.id,
    updated.version,
  );
  assert.equal(deletion.affectedCriteriaCount, 2);
  const survivor = deletion.criteria.find(({ id }) => id === composition.id);
  assert.ok(survivor);
  assert.equal(survivor.version, current.version + 1);
  assert.deepEqual(
    survivor.criterionSequence.map(({ id }) => id),
    [second.id],
  );
  await assertRejectsWithStatus(() => application.criterion.getCriteria(emptied.id), 404);
  const historical = await application.evaluationResults.getRun(actorUserId, run.id);
  assert.deepEqual(historical.cases, original.cases);
  assert.equal(historical.configurationFingerprint, original.configurationFingerprint);
  await application.criterion.deleteCriteria(survivor.id, survivor.version);
  assert.equal((await application.criterion.getCriterion(second.id)).id, second.id);
}

/** Proves atomic batch rollback and agreement between historical reports, compatible trends, and filtered results. */
async function exerciseEvaluationHistory(
  application: ApplicationServices,
  actorUserId: string,
  databaseUrl: string,
): Promise<void> {
  const prompt = await application.prompts.createPrompt(actorUserId, {
    title: "Historical report parity",
    markdown: "Return a deterministic response.",
  });
  const input = {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
    judgeModels: [MODEL_ID],
    cases: [
      {
        input: "Same historical case",
        criteria: [{ name: "Consistent", type: "boolean", instruction: "Check the response." }],
      },
    ],
  };
  const first = await application.evaluations.startHumanRun(actorUserId, input);
  await waitForEvaluation(application, actorUserId, first.id);
  const second = await application.evaluations.startHumanRun(actorUserId, input);
  await waitForEvaluation(application, actorUserId, second.id);
  const report = await application.evaluationResults.getRun(actorUserId, second.id);
  assert.equal(report.configurationFingerprint, first.configurationFingerprint);
  assert.equal(report.promptMarkdown, prompt.markdown);
  assert.equal(report.cases[0]?.scores[0]?.value, true);
  const trend = await application.evaluationResults.getCompatibleBooleanTrend(second.id);
  assert.deepEqual(
    trend.map((point) => point.runId),
    [first.id, second.id],
  );
  assert.ok(
    trend.every(
      (point) =>
        point.rates.length === 1 && point.rates[0]?.passed === 1 && point.rates[0]?.total === 1,
    ),
  );
  const listed = await application.evaluationResults.listResults({ runId: second.id });
  assert.equal(listed.items[0]?.caseId, report.cases[0]?.id);
  const analytics = await application.evaluationResults.getAnalytics({ runId: second.id });
  assert.deepEqual(analytics.totals, { runs: 1, cases: 1, scores: 1 });
  const counted = await application.evaluationResults.query({
    operation: "count",
    entity: "cases",
    runId: second.id,
  });
  assert.equal(counted.value, 1);
  const { Database } = await import("../src/vibe-prompting/database/index.ts");
  const { EvaluationRunStore } = await import("../src/vibe-prompting/evaluation/runs/store.ts");
  const { EvaluationPreparation } =
    await import("../src/vibe-prompting/evaluation/runs/preparation.ts");
  const database = new Database(databaseUrl);
  try {
    const store = new EvaluationRunStore(database);
    const preparation = new EvaluationPreparation(
      application.prompts,
      application.targets,
      application.targetRuns,
      application.models,
    );
    const record = await preparation.run(actorUserId, input, "human", null);
    await assert.rejects(
      store.createBatch([record, { ...record, promptRevisionId: randomUUID() }]),
    );
    assert.equal(
      (await application.evaluations.listRuns(actorUserId, { promptId: prompt.id })).length,
      2,
    );
  } finally {
    await database.close();
  }
}

/** Exercises natural Driver completion, the hard turn limit, and cancellation of attached Target work. */
async function exerciseGenerativeScenarios(
  application: ApplicationServices,
  actorUserId: string,
): Promise<void> {
  const prompt = await application.prompts.createPrompt(actorUserId, {
    title: "Generative Scenario checks",
    markdown: "Respond to the user's question.",
  });
  const input = {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
    mode: "generative",
    instruction: "Ask one question, then finish.",
  };
  const natural = await application.scenarios.startHumanRun(actorUserId, { ...input, maxTurns: 3 });
  const ended = await waitForScenario(application, actorUserId, natural.scenario.id);
  assert.equal(ended.scenario.status, "completed");
  assert.equal(ended.scenario.stopReason, "driver-ended");
  assert.equal(ended.scenario.mode, "generative");
  if (ended.scenario.mode !== "generative") throw new Error("Expected a generative Scenario.");
  assert.equal(ended.scenario.driverModel, MODEL_ID);
  assert.equal(ended.scenario.driverBrief, "Ask once and finish.");
  assert.deepEqual(
    ended.target?.turns.map(({ input }) => input),
    ["First generated user turn."],
  );
  assert.deepEqual(ended.evaluations, []);

  const bounded = await application.scenarios.startHumanRun(actorUserId, { ...input, maxTurns: 1 });
  const limited = await waitForScenario(application, actorUserId, bounded.scenario.id);
  assert.equal(limited.scenario.status, "completed");
  assert.equal(limited.scenario.stopReason, "maximum-turns");
  assert.equal(limited.target?.turns.length, 1);

  const started = await application.scenarios.startHumanRun(actorUserId, {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
    mode: "static",
    messages: Array.from({ length: 10 }, (_value, index) => `Cancellation turn ${index + 1}.`),
  });
  await poll(
    () => application.scenarios.getRunResponse(actorUserId, started.scenario.id),
    ({ target }) => Boolean(target?.turns.some(({ status }) => status === "running")),
    "Scenario with an active Target turn",
  );
  const cancelled = await application.scenarios.cancel(actorUserId, started.scenario.id);
  assert.equal(cancelled.scenario.status, "cancelled");
  assert.ok(cancelled.target?.turns.some(({ status }) => status === "cancelled"));
  assert.deepEqual(cancelled.evaluations, []);
}

/** Proves that shutdown interrupts active work, preserves queued work, and finishes database writes before pool closure. */
async function exerciseRuntimeShutdown(
  application: ApplicationServices,
  actorUserId: string,
  databaseUrl: string,
): Promise<void> {
  const prompt = await application.prompts.createPrompt(actorUserId, {
    title: "Runtime shutdown",
    markdown: "lifecycle-shutdown: produce a deterministic response.",
  });
  const scenario = await application.scenarios.startHumanRun(actorUserId, {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModel: MODEL_ID,
    mode: "static",
    messages: Array.from({ length: 10 }, () => "Keep the Scenario active."),
  });
  const batch = await application.evaluations.startHumanBatch(actorUserId, {
    promptId: prompt.id,
    promptRevisionId: prompt.revisionId,
    targetModels: [MODEL_ID],
    judgeModels: [MODEL_ID],
    configurations: [
      {
        id: "shutdown",
        name: "Shutdown",
        criteria: [{ name: "Shutdown", type: "boolean", instruction: "Check the response." }],
      },
    ],
    cases: [{ input: "lifecycle-shutdown: evaluate this response." }],
    repetitions: 4,
  });
  const active = await poll(
    async () => ({
      scenario: await application.scenarios.getRunResponse(actorUserId, scenario.scenario.id),
      runs: await application.evaluations.listRuns(actorUserId, { promptId: prompt.id }),
    }),
    ({ scenario, runs }) =>
      Boolean(scenario.target?.turns.some((turn) => turn.status === "running")) &&
      runs.some((run) => run.status === "running") &&
      runs.some((run) => run.status === "queued"),
    "active workflow shutdown setup",
  );
  assert.ok(active.scenario.target);
  const queuedRun = active.runs.find((run) => run.status === "queued");
  assert.ok(queuedRun);
  const queuedWaiter = assert.rejects(
    application.evaluations.waitForRun(actorUserId, queuedRun.id),
    /runtime closed/,
  );
  application.onClose(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
  const close = application.close();
  assert.equal(application.close(), close);
  await close;
  await queuedWaiter;
  assert.equal(application.closed, true);
  const { createModel } = await import("../src/vibe-prompting/clients/llm/langchain.ts");
  assert.equal(
    (await createModel({ model: MODEL_ID }).invoke("Standalone after application shutdown.")).text,
    "Deterministic target output.",
  );
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [storedScenario] = await sql<
      { status: string }[]
    >`SELECT status FROM scenario_runs WHERE id = ${scenario.scenario.id}`;
    assert.equal(storedScenario?.status, "interrupted");
    const turns = await sql<
      { status: string }[]
    >`SELECT status FROM target_run_turns WHERE run_id = ${active.scenario.target.id}`;
    assert.ok(turns.some((turn) => turn.status === "interrupted"));
    assert.ok(turns.every((turn) => turn.status !== "running"));
    const statuses = await sql<
      { status: string }[]
    >`SELECT status FROM evaluation_runs WHERE id = ANY(${sql.array(batch.runs.map((run) => run.id))}::uuid[])`;
    assert.ok(statuses.some((run) => run.status === "queued"));
    assert.ok(statuses.some((run) => run.status === "interrupted"));
    assert.ok(statuses.every((run) => run.status !== "running" && run.status !== "failed"));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function exerciseRestartReconciliation(
  databaseUrl: string,
  application: ApplicationServices,
  viewerUserId: string,
): Promise<{ interrupted: number; services: ApplicationServices }> {
  await application.close();
  const sql = postgres(databaseUrl, {
    max: 1,
    onnotice: () => undefined,
    transform: postgres.camel,
  });
  let runningRunId: string;
  let queuedRunId: string;
  try {
    const [source] = await sql<{ id: string }[]>`
      SELECT id FROM evaluation_runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1
    `;
    assert.ok(source);
    runningRunId = await cloneEvaluationRun(sql, source.id, "running");
    queuedRunId = await cloneEvaluationRun(sql, source.id, "queued");
  } finally {
    await sql.end({ timeout: 5 });
  }

  const { createApplicationServices } = await import("../src/vibe-prompting/server.ts");
  const restarted = await createApplicationServices(databaseUrl);
  const abandoned = await restarted.evaluations.getRunSummary(viewerUserId, runningRunId!);
  assert.equal(abandoned.status, "interrupted");
  const resumed = await waitForEvaluation(restarted, viewerUserId, queuedRunId!);
  assert.equal(resumed.status, "completed");
  return { interrupted: 1, services: restarted };
}

async function cloneEvaluationRun(
  sql: postgres.Sql,
  sourceRunId: string,
  status: "queued" | "running",
): Promise<string> {
  const runId = randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO evaluation_runs (
        id, prompt_id, prompt_revision_id, chat_id, source, target_model_id,
        judge_model_ids, status, configuration_fingerprint, error_message,
        is_synthetic_example, target_profile_id, target_profile_revision_id,
        effective_instructions_hash, target_run_id, target_run_turn_id,
        started_by_user_id, created_at, completed_at
      )
      SELECT
        ${runId}, prompt_id, prompt_revision_id, chat_id, source, target_model_id,
        judge_model_ids, ${status}, configuration_fingerprint, NULL,
        is_synthetic_example, target_profile_id, target_profile_revision_id,
        effective_instructions_hash, target_run_id, target_run_turn_id,
        started_by_user_id, now(), NULL
      FROM evaluation_runs
      WHERE id = ${sourceRunId}
    `;
    await transaction`
      INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
      SELECT ${randomUUID()}, ${runId}, position, input_json, criteria_json, NULL
      FROM evaluation_cases
      WHERE run_id = ${sourceRunId}
      ORDER BY position
    `;
  });
  return runId;
}

async function readInvariants(databaseUrl: string): Promise<Record<string, number>> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql<Record<string, number>[]>`
      SELECT
        (SELECT count(*)::integer FROM chats WHERE owner_user_id IS NULL) AS ownerless_chats,
        (SELECT count(*)::integer FROM prompt_revisions WHERE created_by_user_id IS NULL) AS actorless_prompt_revisions,
        (SELECT count(*)::integer FROM target_profile_revisions WHERE created_by_user_id IS NULL) AS actorless_target_revisions,
        (SELECT count(*)::integer FROM evaluation_runs WHERE started_by_user_id IS NULL) AS actorless_evaluations,
        (SELECT count(*)::integer FROM scenario_runs WHERE started_by_user_id IS NULL) AS actorless_scenarios,
        (SELECT count(*)::integer FROM target_runs WHERE started_by_user_id IS NULL) AS actorless_target_runs,
        (SELECT count(*)::integer FROM target_run_turns WHERE created_by_user_id IS NULL) AS actorless_target_turns,
        (SELECT count(*)::integer FROM evaluation_criteria WHERE created_by_user_id IS NULL OR updated_by_user_id IS NULL) AS actorless_criteria,
        (SELECT count(*)::integer FROM evaluation_criterion WHERE created_by_user_id IS NULL OR updated_by_user_id IS NULL) AS actorless_criterion,
        (SELECT count(*)::integer FROM evaluation_runs WHERE status IN ('queued', 'running')) AS nonterminal_evaluations,
        (SELECT count(*)::integer FROM scenario_runs WHERE status IN ('queued', 'running')) AS nonterminal_scenarios,
        (SELECT count(*)::integer FROM target_run_turns WHERE status = 'running') AS running_target_turns,
        (SELECT count(*)::integer FROM (SELECT prompt_id, revision_number FROM prompt_revisions GROUP BY prompt_id, revision_number HAVING count(*) > 1) duplicates) AS duplicate_prompt_revisions,
        (SELECT count(*)::integer FROM (SELECT target_profile_id, revision_number FROM target_profile_revisions GROUP BY target_profile_id, revision_number HAVING count(*) > 1) duplicates) AS duplicate_target_revisions,
        (SELECT count(*)::integer FROM (SELECT case_id, criterion_position, judge_model_id FROM evaluation_scores GROUP BY case_id, criterion_position, judge_model_id HAVING count(*) > 1) duplicates) AS duplicate_scores
    `;
    assert.ok(row);
    return row;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function waitForEvaluation(
  application: ApplicationServices,
  viewerUserId: string,
  runId: string,
) {
  return poll(
    () => application.evaluations.getRunSummary(viewerUserId, runId),
    (run) => TERMINAL_EVALUATION_STATUSES.has(run.status),
    `evaluation ${runId}`,
  );
}

async function waitForTarget(
  application: ApplicationServices,
  viewerUserId: string,
  runId: string,
) {
  return poll(
    () => application.targetRuns.getRun(viewerUserId, runId),
    (run) => TERMINAL_TARGET_STATUSES.has(run.latestStatus),
    `Target Run ${runId}`,
  );
}

async function waitForScenario(
  application: ApplicationServices,
  viewerUserId: string,
  runId: string,
) {
  return poll(
    () => application.scenarios.getRunResponse(viewerUserId, runId),
    ({ evaluations, scenario }) =>
      TERMINAL_EVALUATION_STATUSES.has(scenario.status) &&
      evaluations.every(({ status }) => TERMINAL_EVALUATION_STATUSES.has(status)),
    `Scenario Run ${runId}`,
  );
}

async function poll<T>(
  read: () => Promise<T>,
  complete: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (complete(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function assertSettledCounts(
  label: string,
  results: PromiseSettledResult<unknown>[],
  expectedFulfilled: number,
  expectedRejected: number,
  expectedStatus: number,
): void {
  const fulfilled = results.filter(({ status }) => status === "fulfilled");
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.equal(fulfilled.length, expectedFulfilled, `${label} fulfilled count`);
  assert.equal(rejected.length, expectedRejected, `${label} rejected count`);
  rejected.forEach(({ reason }) => {
    const status = readStatusCode(reason);
    if (status !== expectedStatus) {
      const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
      throw new Error(`${label} collision returned ${status ?? "no status"}: ${detail}`);
    }
  });
}

async function assertRejectsWithStatus(
  operation: () => Promise<unknown>,
  status: number,
): Promise<void> {
  await assert.rejects(operation, (error) => readStatusCode(error) === status);
}

function readStatusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : undefined;
}

function readRetryAfter(error: unknown): number {
  return typeof error === "object" && error !== null && "retryAfterSeconds" in error
    ? Number(error.retryAfterSeconds)
    : 0;
}

function countStatuses(statuses: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

async function startFakeProvider(): Promise<FakeProvider> {
  let active = 0;
  let callCount = 0;
  let observedMax = 0;
  const requests: Array<{
    path: string;
    stream: boolean;
    structured: boolean;
    toolCount: number;
  }> = [];
  const server = createServer(async (request, response) => {
    active += 1;
    callCount += 1;
    observedMax = Math.max(observedMax, active);
    try {
      const body = await readRequestBody(request);
      requests.push({
        path: request.url ?? "",
        stream: body.stream === true,
        structured: typeof body.response_format === "object" && body.response_format !== null,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      });
      // Hold the cancellation fixture until the client disconnects so completion cannot race the assertion.
      if (JSON.stringify(body.messages).includes("Cancellation turn")) {
        await new Promise<void>((resolve) => response.once("close", resolve));
        return;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          JSON.stringify(body.messages).includes("lifecycle-shutdown") ? 150 : 35,
        ),
      );
      if (request.url?.endsWith("/embeddings")) writeEmbeddingResponse(response, body);
      else if (body.stream === true) writeStreamResponse(response, body);
      else writeChatResponse(response, body);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : "Fake provider failed." },
        }),
      );
    } finally {
      active -= 1;
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls: () => callCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    maxConcurrency: () => observedMax,
    requests: () => requests.slice(),
    reset() {
      active = 0;
      callCount = 0;
      observedMax = 0;
      requests.length = 0;
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const source = Buffer.concat(chunks).toString("utf8");
  return source ? (JSON.parse(source) as Record<string, unknown>) : {};
}

function writeChatResponse(response: ServerResponse, body: Record<string, unknown>): void {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const tool = tools[0] as
    | {
        function?: {
          name?: string;
          parameters?: { properties?: Record<string, unknown> };
        };
      }
    | undefined;
  const toolName = tool?.function?.name;
  const responseFormat = body.response_format as
    | {
        json_schema?: {
          schema?: {
            properties?: Record<string, unknown>;
          };
        };
      }
    | undefined;
  const structuredProperties = responseFormat?.json_schema?.schema?.properties ?? {};
  const structuredResultNames = Object.keys(structuredProperties);
  // The compatible AI SDK client uses JSON mode and places the Driver contract in messages.
  const requestMessages = JSON.stringify(body.messages ?? []);
  const initialDriver = requestMessages.includes("<scenario_instruction>");
  const continuingDriver = requestMessages.includes("<public_transcript>");
  const structuredContent =
    structuredResultNames.includes("title") && structuredResultNames.includes("icons")
      ? JSON.stringify({
          title: "Backend conversation",
          icons: ["message-circle", "messages-square", "bot"],
        })
      : initialDriver || continuingDriver
        ? JSON.stringify(
            initialDriver
              ? {
                  action: "send",
                  message: "First generated user turn.",
                  driverBrief: "Ask once and finish.",
                }
              : { action: "end", message: null },
          )
        : structuredResultNames.length > 0
          ? JSON.stringify(
              Object.fromEntries(
                structuredResultNames.map((name) => [
                  name,
                  { value: true, comment: "Deterministic pass.", evidence: [] },
                ]),
              ),
            )
          : undefined;
  const toolCall = toolName
    ? [
        {
          id: `call_${randomUUID().replaceAll("-", "")}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(
              Object.fromEntries(
                Object.keys(tool.function?.parameters?.properties ?? { criterion_1: {} }).map(
                  (name) => [name, { value: true, comment: "Deterministic pass.", evidence: [] }],
                ),
              ),
            ),
          },
        },
      ]
    : undefined;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: String(body.model ?? MODEL_ID),
      choices: [
        {
          index: 0,
          message: toolCall
            ? { role: "assistant", content: null, tool_calls: toolCall }
            : {
                role: "assistant",
                content: structuredContent ?? "Deterministic target output.",
              },
          finish_reason: toolCall ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }),
  );
}

function writeStreamResponse(response: ServerResponse, body: Record<string, unknown>): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  const id = `chatcmpl-${randomUUID()}`;
  response.write(
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: String(body.model ?? MODEL_ID), choices: [{ index: 0, delta: { role: "assistant", content: "Deterministic target output." }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: String(body.model ?? MODEL_ID), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

function writeEmbeddingResponse(response: ServerResponse, body: Record<string, unknown>): void {
  const input = Array.isArray(body.input) ? body.input : [body.input];
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      object: "list",
      data: input.map((_value, index) => ({ object: "embedding", index, embedding: [1, 0, 0] })),
      model: String(body.model ?? MODEL_ID),
      usage: { prompt_tokens: input.length, total_tokens: input.length },
    }),
  );
}
