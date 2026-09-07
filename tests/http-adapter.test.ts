/** Exercises the actual Fastify router and shared browser error responses with application and model effects controlled at their boundaries. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, mock, test } from "node:test";

import type { InjectOptions } from "fastify";
import { z } from "zod";

import type { ApplicationServices } from "../src/vibe-prompting/app/application.ts";
import { projectServerError } from "../src/vibe-prompting/app/errors.ts";

const actor = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";
const criterion = { name: "Helpful", type: "boolean", instruction: "Check helpfulness." };
const runInput = {
  promptId: id,
  promptRevisionId: id,
  targetModel: "model",
  judgeModels: ["judge"],
  cases: [{ input: "Question", criteria: [criterion] }],
};
const batch = {
  promptId: id,
  promptRevisionId: id,
  targetModels: ["model"],
  judgeModels: ["judge"],
  configurations: [{ id: "one", name: "One", criteria: [criterion] }],
  cases: [{ input: "Question" }],
  repetitions: 1,
};
const calls: Array<{ method: string; args: unknown[] }> = [];
const record =
  (method: string, output: unknown) =>
  async (...args: unknown[]) => {
    calls.push({ method, args });
    return output;
  };
mock.module("../src/vibe-prompting/agents/openai-agents/prompt-edit.ts", {
  namedExports: {
    streamPromptEdit: async () => {
      throw new Error("Unexpected streaming edit.");
    },
    editPrompt: record("editPrompt", {
      markdown: "Edited",
      model: { id: "model" },
      message: "Done",
    }),
  },
});
mock.module("../src/vibe-prompting/clients/llm/langchain.ts", {
  namedExports: {
    createModel: () => ({ invoke: record("invokeModel", { text: "Answer" }) }),
  },
});
mock.module("../src/vibe-prompting/evaluation/results/explorer.ts", {
  namedExports: {
    evaluationExplorerQuestionSchema: z.string().trim().min(1).max(1000),
    exploreEvaluations: record("exploreEvaluations", { answer: "Explored" }),
  },
});
const { createApiServer } = await import("../src/vibe-prompting/app/api.ts");
const { serverErrorResponse } = await import("../frontend/server/errors.ts");
after(() => mock.restoreAll());

function application(): ApplicationServices {
  return {
    closed: false,
    models: {},
    auth: { requireActiveUser: record("requireActiveUser", { id: actor }) },
    getConfiguredModels: record("getConfiguredModels", [{ id: "model" }]),
    prompts: {
      createPrompt: record("createPrompt", { id }),
      listPrompts: record("listPrompts", [{ id }]),
      getPrompt: record("getPrompt", { id, activeRevisionId: id }),
      appendAiEdit: record("appendAiEdit", { id, markdown: "Edited" }),
    },
    evaluations: {
      listRuns: record("listRuns", [{ id }]),
      startHumanRun: record("startHumanRun", { id, status: "queued" }),
      previewBatch: record("previewBatch", { jobs: [] }),
      getRunSummary: record("getRunSummary", { id }),
      startHumanBatch: record("startHumanBatch", { runs: [{ id }] }),
    },
    criterion: Object.fromEntries(
      [
        ["listCriterion", [criterion]],
        ["createCriterion", criterion],
        ["getCriterion", criterion],
        ["updateCriterion", criterion],
        ["deleteCriterion", { affectedCriteriaCount: 0, criteria: [] }],
        ["listCriteria", []],
        ["createCriteria", { id }],
        ["getCriteria", { id }],
        ["updateCriteria", { id }],
        ["deleteCriteria", undefined],
      ].map(([name, output]) => [name, record(String(name), output)]),
    ),
    evaluationResults: {
      listResults: record("listResults", { items: [] }),
      getResult: record("getResult", { id }),
      getAnalytics: record("getAnalytics", { count: 1 }),
      query: record("query", { count: 1 }),
      getRun: record("getRun", { id }),
      getCompatibleBooleanTrend: record("getCompatibleBooleanTrend", []),
    },
    evaluator: {
      invoke: async (input: { target: { invoke(input: string): Promise<string> } }) => ({
        results: [{ output: await input.target.invoke("Question"), evaluations: [] }],
      }),
    },
  } as unknown as ApplicationServices;
}

test("HTTP operations preserve their OpenAPI schemas and dispatch to the expected capability", async () => {
  const server = await createApiServer(application());
  try {
    await server.ready();
    const fingerprints = Object.fromEntries(
      Object.entries(server.swagger().paths ?? {}).flatMap(([path, methods]) =>
        Object.entries(methods ?? {}).map(([method, schema]) => [
          `${method.toUpperCase()} ${path}`,
          createHash("sha256")
            .update(JSON.stringify(stable(schema)))
            .digest("hex"),
        ]),
      ),
    );
    assert.deepEqual(
      fingerprints,
      JSON.parse(readFileSync(new URL("./fixtures/http-routes.json", import.meta.url), "utf8")),
    );
    const requests: Array<[InjectOptions, number, string]> = [
      [{ method: "GET", url: "/api/config" }, 200, "getConfiguredModels"],
      [{ method: "GET", url: "/api/prompts" }, 200, "listPrompts"],
      [
        {
          method: "POST",
          url: "/api/prompts",
          payload: { actorUserId: actor, title: " Test ", markdown: "Text" },
        },
        200,
        "createPrompt",
      ],
      [
        {
          method: "POST",
          url: `/api/prompts/${id}/edits`,
          payload: {
            actorUserId: actor,
            revisionId: id,
            markdown: "Text",
            instruction: "Edit",
            modelId: "model",
          },
        },
        200,
        "appendAiEdit",
      ],
      [{ method: "POST", url: "/api/evaluate", payload: runInput }, 200, "invokeModel"],
      [{ method: "GET", url: `/api/evaluations?viewerUserId=${actor}` }, 200, "listRuns"],
      [
        { method: "POST", url: "/api/evaluations", payload: { ...runInput, actorUserId: actor } },
        202,
        "startHumanRun",
      ],
      [{ method: "POST", url: "/api/evaluations/preview", payload: batch }, 200, "previewBatch"],
      [
        {
          method: "GET",
          url: `/api/evaluations/batches?viewerUserId=${actor}&runId=${id}&runId=${id}`,
        },
        200,
        "getRunSummary",
      ],
      [
        {
          method: "POST",
          url: "/api/evaluations/batches",
          payload: { ...batch, actorUserId: actor },
        },
        202,
        "startHumanBatch",
      ],
      [{ method: "GET", url: "/api/evaluations/criterion" }, 200, "listCriterion"],
      [
        {
          method: "POST",
          url: "/api/evaluations/criterion",
          payload: { ...criterion, actorUserId: actor },
        },
        201,
        "createCriterion",
      ],
      [{ method: "GET", url: `/api/evaluations/criterion/${id}` }, 200, "getCriterion"],
      [
        {
          method: "PUT",
          url: `/api/evaluations/criterion/${id}`,
          payload: { ...criterion, actorUserId: actor, expectedVersion: 1 },
        },
        200,
        "updateCriterion",
      ],
      [
        {
          method: "DELETE",
          url: `/api/evaluations/criterion/${id}`,
          payload: { actorUserId: actor, expectedVersion: 1 },
        },
        200,
        "deleteCriterion",
      ],
      [{ method: "GET", url: "/api/evaluations/criteria" }, 200, "listCriteria"],
      [
        {
          method: "POST",
          url: "/api/evaluations/criteria",
          payload: { name: "Rules", criterionIds: [id], actorUserId: actor },
        },
        201,
        "createCriteria",
      ],
      [{ method: "GET", url: `/api/evaluations/criteria/${id}` }, 200, "getCriteria"],
      [
        {
          method: "PUT",
          url: `/api/evaluations/criteria/${id}`,
          payload: { name: "Rules", criterionIds: [id], actorUserId: actor, expectedVersion: 1 },
        },
        200,
        "updateCriteria",
      ],
      [
        {
          method: "DELETE",
          url: `/api/evaluations/criteria/${id}`,
          payload: { actorUserId: actor, expectedVersion: 1 },
        },
        204,
        "deleteCriteria",
      ],
      [{ method: "GET", url: "/api/evaluations/results" }, 200, "listResults"],
      [{ method: "GET", url: `/api/evaluations/results/${id}` }, 200, "getResult"],
      [{ method: "GET", url: "/api/evaluations/analytics" }, 200, "getAnalytics"],
      [
        {
          method: "POST",
          url: "/api/evaluations/query",
          payload: { operation: "count", entity: "cases" },
        },
        200,
        "query",
      ],
      [
        { method: "POST", url: "/api/evaluations/explorer", payload: { question: "How many?" } },
        200,
        "exploreEvaluations",
      ],
      [{ method: "GET", url: `/api/evaluations/${id}?viewerUserId=${actor}` }, 200, "getRun"],
    ];
    for (const [request, status, method] of requests) {
      calls.length = 0;
      const response = await server.inject(request);
      assert.equal(
        response.statusCode,
        status,
        `${request.method} ${request.url}: ${response.body}`,
      );
      assert.ok(
        calls.some((call) => call.method === method),
        method,
      );
      if (typeof request.url === "string" && request.url.startsWith("/api/evaluations"))
        assert.equal(response.headers["cache-control"], "no-store");
      if (method === "createPrompt")
        assert.deepEqual(calls, [
          { method: "requireActiveUser", args: [actor] },
          { method, args: [actor, { title: "Test", markdown: "Text" }] },
        ]);
      if (method === "appendAiEdit")
        assert.deepEqual(
          calls.map((call) => call.method),
          ["requireActiveUser", "getPrompt", "editPrompt", "appendAiEdit"],
        );
      if (method === "listRuns") assert.deepEqual(calls.at(-1)?.args, [actor, { limit: 50 }]);
      if (method === "getRunSummary")
        assert.equal(calls.filter((call) => call.method === method).length, 2);
      if (method === "getRun") assert.deepEqual(response.json(), { run: { id }, trend: [] });
    }
    assert.equal((await server.inject("/healthz")).body, "ok");
  } finally {
    await server.close();
  }
});

test("HTTP validation and active-user checks precede effects, and internal failures stay private", async () => {
  const app = application();
  const server = await createApiServer(app);
  const request: InjectOptions = {
    method: "POST",
    url: "/api/prompts",
    payload: { actorUserId: actor, title: "Test", markdown: "Text" },
  };
  try {
    calls.length = 0;
    const invalid = await server.inject({
      ...request,
      payload: { actorUserId: "invalid", title: "Test", markdown: "Text" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "Invalid request.");
    assert.equal(calls.length, 0);
    const malformed = await server.inject({
      ...request,
      payload: "{",
      headers: { "content-type": "application/json" },
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(
      malformed.json().error,
      "Body is not valid JSON but content-type is set to 'application/json'",
    );
    app.auth.requireActiveUser = async () => {
      throw Object.assign(new Error("Membership required."), { statusCode: 403 });
    };
    assert.equal((await server.inject(request)).statusCode, 403);
    assert.equal(calls.length, 0);
    app.auth.requireActiveUser = record("requireActiveUser", { id: actor }) as never;
    app.prompts.createPrompt = async () => {
      throw Object.assign(new Error("Conflict."), { statusCode: 409 });
    };
    assert.deepEqual((await server.inject(request)).json(), { error: "Conflict." });
    app.prompts.createPrompt = async () => {
      throw new Error("private database details");
    };
    const internal = await server.inject(request);
    assert.equal(internal.statusCode, 500);
    assert.deepEqual(internal.json(), { error: "The server could not complete the request." });
    Object.defineProperty(app, "closed", { value: true });
    assert.equal((await server.inject(request)).statusCode, 503);
  } finally {
    await server.close();
  }
});

test("browser and HTTP error policy retain client errors and reject invalid response statuses", async () => {
  for (const statusCode of [200, 700, NaN, 400.5]) {
    assert.equal(
      projectServerError(Object.assign(new Error("internal"), { statusCode }), "Fallback").status,
      500,
    );
  }
  const internal = serverErrorResponse(new Error("private"), "Storage failed.");
  assert.equal(internal.status, 500);
  assert.equal(internal.headers.get("cache-control"), "no-store");
  assert.deepEqual(await internal.json(), { error: "Storage failed." });
  const conflict = serverErrorResponse(
    Object.assign(new Error("Conflict."), { statusCode: 409, code: "conflict" }),
    "Fallback",
  );
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { code: "conflict", error: "Conflict." });
  assert.equal(projectServerError(z.string().safeParse(1).error, "Fallback").status, 400);
});

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, stable(item)]),
      )
    : value;
}
