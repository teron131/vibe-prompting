/** Checks canonical Criterion enforcement and locks the existing judge prompt and provider response format. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { z } from "zod";

import { criteriaSchema, type Criterion } from "../src/vibe-prompting/criteria/schemas.ts";
import {
  buildCriteriaPrompt,
  buildCriteriaSystemPrompt,
} from "../src/vibe-prompting/evaluation/engine/prompts.ts";
import {
  createEvaluationResponseSchema,
  projectEvaluationResponse,
} from "../src/vibe-prompting/evaluation/engine/schemas.ts";

const criteria: Criterion[] = [
  { name: "Helpful", type: "boolean", instruction: "Check helpfulness." },
  {
    name: "Category",
    type: "categorical",
    categories: ["clear", "unclear"],
    instruction: "Choose clarity.",
  },
  { name: "Rating", type: "numeric", min: 1, max: 5, instruction: "Rate quality." },
  { name: "Notes", type: "text", instruction: "Give feedback." },
  { name: "Rewrite", type: "correction", instruction: "Correct the answer." },
];
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/evaluation-judge.json", import.meta.url), "utf8"),
);

test("canonical criteria produce the exact committed judge prompts and structured response schema", () => {
  assert.equal(buildCriteriaSystemPrompt(criteria), fixture.system);
  assert.equal(
    buildCriteriaPrompt({ input: "Question", output: "Answer" }, criteria),
    fixture.prompt,
  );
  assert.deepEqual(
    z.toJSONSchema(createEvaluationResponseSchema(criteria)),
    fixture.responseSchema,
  );
});

test("judge output enforces all five value types and retains criterion ordering", () => {
  const schema = createEvaluationResponseSchema(criteria);
  const values = {
    Helpful: true,
    Category: "clear",
    Rating: 4,
    Notes: "Useful",
    Rewrite: "Correct answer",
  };
  const response = Object.fromEntries(
    Object.entries(values)
      .reverse()
      .map(([name, value]) => [name, { value, comment: "Supported", evidence: [] }]),
  );
  const results = projectEvaluationResponse(schema.parse(response), criteria);
  assert.deepEqual(
    results.map(({ name }) => name),
    criteria.map(({ name }) => name),
  );
  assert.deepEqual(
    results.map(({ dataType }) => dataType),
    ["BOOLEAN", "CATEGORICAL", "NUMERIC", "TEXT", "CORRECTION"],
  );
  for (const [name, value] of [
    ["Helpful", "true"],
    ["Category", "unknown"],
    ["Rating", 6],
    ["Rating", Number.NaN],
    ["Notes", "x".repeat(501)],
    ["Rewrite", ""],
  ]) {
    assert.equal(
      schema.safeParse({
        ...response,
        [String(name)]: { value, comment: "Supported", evidence: [] },
      }).success,
      false,
    );
  }
  const { Helpful: _, ...missing } = response;
  assert.equal(schema.safeParse(missing).success, false);
});

test("the engine accepts only the canonical Criterion rules", () => {
  const repeated = [criteria[0]!, { ...criteria[0]!, name: "helpful" }];
  assert.equal(criteriaSchema.safeParse(repeated).success, false);
  assert.throws(() => createEvaluationResponseSchema(repeated));
  assert.throws(() =>
    createEvaluationResponseSchema([
      { name: "Bad range", type: "numeric", min: 5, max: 1, instruction: "Check" },
    ]),
  );
  assert.throws(() =>
    createEvaluationResponseSchema([
      { name: "A", type: "correction", instruction: "Check" },
      { name: "B", type: "correction", instruction: "Check" },
    ]),
  );
});
