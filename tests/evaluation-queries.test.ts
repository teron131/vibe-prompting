/** Verifies that focused result queries avoid full analytics and retain filter, grouping, and cursor error semantics. */

import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

import type { Database } from "../src/vibe-prompting/database/index.ts";
import type { NormalizedFilters } from "../src/vibe-prompting/evaluation/results/schemas.ts";
import type { HybridSearch } from "../src/vibe-prompting/search.ts";

const queries = await import("../src/vibe-prompting/evaluation/results/queries.ts");
const calls: Array<{ name: string; filters: NormalizedFilters }> = [];
const facets = {
  prompts: [],
  revisions: [],
  statuses: [],
  judgeModels: [],
  dataTypes: [],
  targetModels: [
    { value: "first", count: 7 },
    { value: "second", count: 3 },
  ],
};
mock.module("../src/vibe-prompting/evaluation/results/queries.ts", {
  namedExports: {
    ...Object.fromEntries(
      Object.keys(queries).map((name) => [
        name,
        () => {
          throw new Error(`Unnecessary query: ${name}`);
        },
      ]),
    ),
    selectGroupedRows: queries.selectGroupedRows,
    selectTotals: async (_sql: unknown, filters: NormalizedFilters) => {
      calls.push({ name: "totals", filters });
      return [{ cases: 7, runs: 2, scores: 14 }];
    },
    selectFacets: async (_sql: unknown, filters: NormalizedFilters) => {
      calls.push({ name: "facets", filters });
      return facets;
    },
  },
});
const { EvaluationResults } = await import("../src/vibe-prompting/evaluation/results/service.ts");
const results = new EvaluationResults(
  { run: async (operation: (sql: unknown) => unknown) => operation({}) } as Database,
  {} as HybridSearch,
);
after(() => mock.restoreAll());
beforeEach(() => {
  calls.length = 0;
});

test("counts request only totals while retaining normalized filters and response metadata", async () => {
  const result = await results.query({
    operation: "count",
    entity: "cases",
    targetModels: ["first"],
    from: "2026-01-01",
  });
  assert.equal(result.value, 7);
  assert.equal(result.matchedCount, 7);
  assert.equal(result.answer, "7 cases match the current filters.");
  assert.equal(result.provenance.source, "evaluation_storage");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["totals"],
  );
  assert.deepEqual(calls[0]!.filters.targetModels, ["first"]);
  assert.equal(calls[0]!.filters.from?.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.appliedFilters, { targetModels: ["first"], from: "2026-01-01" });
});

test("grouped counts request only facets and preserve ordering, limits, and matched memberships", async () => {
  const result = await results.query({
    operation: "group_count",
    groupBy: "targetModel",
    limit: 1,
    targetModels: ["first"],
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["facets"],
  );
  assert.deepEqual(calls[0]!.filters.targetModels, ["first"]);
  assert.deepEqual(result.rows, [{ label: "first", value: 7 }]);
  assert.equal(result.value, 7);
  assert.equal(result.matchedCount, 7);
  assert.deepEqual(result.appliedFilters, { targetModels: ["first"] });
});

test("invalid result cursors fail before querying storage and preserve the public error type", async () => {
  await assert.rejects(results.listResults({ cursor: "not-json" }), {
    name: "EvaluationQueryRequestError",
    statusCode: 400,
    message: "Result cursor is invalid.",
  });
  const malformed = Buffer.from(
    JSON.stringify({ runId: "invalid", position: 0, createdAt: "2026-01-01" }),
  ).toString("base64url");
  await assert.rejects(results.listResults({ cursor: malformed }), {
    name: "EvaluationQueryRequestError",
    statusCode: 400,
  });
  assert.equal(calls.length, 0);
});
