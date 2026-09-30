/** Locks published tool metadata and schemas while exercising generic edit scope and shared model-reference rules. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { z } from "zod";

import { resolveConfiguredModelId } from "../src/vibe-prompting/agents/models.ts";
import {
  applyHashlineEdits,
  formatHashlines,
} from "../src/vibe-prompting/agents/tools/hashline.ts";
import {
  type AgentTool,
  AgentToolkit,
  ContextLibraryToolkit,
  createContextEditTools,
  createExaSearchTool,
  createScopedDocument,
  CriteriaLibraryToolkit,
  EvaluationResultsToolkit,
  EvaluationRunsToolkit,
  ScenarioRunsToolkit,
  TargetRunsToolkit,
} from "../src/vibe-prompting/agents/tools/index.ts";

test("all published tool names, descriptions, annotations, and input schemas match the baseline", () => {
  const groups = [
    new ContextLibraryToolkit({} as never),
    new CriteriaLibraryToolkit({} as never),
    new EvaluationRunsToolkit({} as never, {} as never, async () => []),
    new EvaluationResultsToolkit({} as never),
    new ScenarioRunsToolkit({} as never, async () => []),
    new TargetRunsToolkit({} as never, async () => []),
  ];
  const fingerprint = (tool: AgentTool) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          annotations: tool.annotations,
          parameters: z.toJSONSchema(tool.parameters),
        }),
      )
      .digest("hex");
  const snapshot: Record<string, string> = {};
  for (const group of groups)
    for (const tool of group.tools) snapshot[group.id + "/" + tool.name] = fingerprint(tool);
  for (const tool of createContextEditTools(createScopedDocument("text")))
    snapshot["context-edit/" + tool.name] = fingerprint(tool);
  const exa = createExaSearchTool();
  snapshot["web-search/" + exa.name] = fingerprint(exa);
  assert.deepEqual(
    snapshot,
    JSON.parse(readFileSync(new URL("./fixtures/agent-tools.json", import.meta.url), "utf8")),
  );
  assert.equal(AgentToolkit.compose(groups).length, 24);
});

test("document tools are isolated and failed batches cannot partially edit content", async () => {
  const first = createScopedDocument("one\ntwo\nthree\n"),
    second = createScopedDocument("private\n");
  const [read, edit] = createContextEditTools(first);
  assert.deepEqual(read!.parameters.parse({ path: "/etc/passwd" }), {});
  assert.equal(await read!.execute({}, {}), formatHashlines(first.read()));
  const refs = references(first.read());
  await edit!.execute(
    {
      edits: [
        { operation: "replace_range", startRef: refs[1], endRef: refs[1], lines: ["changed"] },
        { operation: "append", lines: ["four"] },
      ],
    },
    {},
  );
  assert.equal(first.read(), "one\nchanged\nthree\nfour\n");
  assert.equal(second.read(), "private\n");
  const unchanged = first.read();
  await assert.rejects(
    Promise.resolve().then(() =>
      edit!.execute(
        {
          edits: [
            { operation: "append", lines: ["must not remain"] },
            { operation: "replace_range", startRef: refs[1], endRef: refs[1], lines: ["stale"] },
          ],
        },
        {},
      ),
    ),
    /Stale hashline/,
  );
  assert.equal(first.read(), unchanged);
  const foreign = references(second.read())[0]!;
  assert.throws(
    () => first.applyEdits([{ operation: "insert_after", startRef: foreign, lines: ["leak"] }]),
    /Stale hashline/,
  );
  assert.equal(first.read(), unchanged);
});

test("Hashline preserves newline and shifted-reference semantics while rejecting ambiguous edits", () => {
  const text = "a\nb\nc\n";
  const refs = references(text);
  assert.equal(
    applyHashlineEdits(text, [
      { operation: "insert_before", startRef: refs[1]!, lines: ["before"] },
      { operation: "insert_after", startRef: refs[2]!, lines: ["after"] },
    ]),
    "a\nbefore\nb\nc\nafter\n",
  );
  assert.equal(
    applyHashlineEdits("prefix\n" + text, [
      { operation: "replace_range", startRef: refs[1]!, endRef: refs[1]!, lines: ["changed"] },
    ]),
    "prefix\na\nchanged\nc\n",
  );
  assert.throws(
    () =>
      applyHashlineEdits(text, [
        { operation: "replace_range", startRef: refs[0]!, endRef: refs[2]!, lines: [] },
        { operation: "insert_after", startRef: refs[1]!, lines: ["overlap"] },
      ]),
    /overlapping|ambiguous/,
  );
  assert.throws(
    () =>
      applyHashlineEdits(text, [
        { operation: "replace_range", startRef: refs[0]!, endRef: refs[0]!, lines: ["a"] },
      ]),
    /do not change/,
  );
  assert.equal(applyHashlineEdits("", [{ operation: "append", lines: ["first"] }]), "first");
  const duplicate = references("x\nb\nx\n")[1]!;
  assert.throws(
    () =>
      applyHashlineEdits("b\nx\nb\n", [
        { operation: "insert_after", startRef: duplicate, lines: ["ambiguous"] },
      ]),
    /Stale hashline/,
  );
});

test("saved context edits keep revision checks and persist only a complete valid batch", async () => {
  const contextId = randomUUID(),
    revisionId = randomUUID();
  let writes = 0;
  const active = {
    id: contextId,
    revisionId,
    activeRevisionId: revisionId,
    markdown: "original\n",
    title: "Context",
    revisionCount: 1,
    updatedAt: "now",
  };
  const toolkit = new ContextLibraryToolkit({
    getContext: async () => active,
    appendAiEdit: async (
      _actor: string,
      input: { editedMarkdown: string; expectedActiveRevisionId: string },
    ) => {
      assert.equal(input.expectedActiveRevisionId, revisionId);
      writes++;
      return { ...active, markdown: input.editedMarkdown };
    },
  } as never);
  const tool = toolkit.tools.find((tool) => tool.name === "edit_context")!;
  const ref = references(active.markdown)[0]!;
  const input = {
    contextId,
    expectedRevisionId: revisionId,
    changeRequest: "Change text",
    edits: [{ operation: "replace_range", startRef: ref, endRef: ref, lines: ["updated"] }],
  };
  await assert.rejects(
    Promise.resolve(
      tool.execute({ ...input, expectedRevisionId: randomUUID() }, { actorUserId: "actor" }),
    ),
    { statusCode: 409 },
  );
  assert.equal(writes, 0);
  await tool.execute(tool.parameters.parse(input), { actorUserId: "actor" });
  assert.equal(writes, 1);
});

test("model references prefer IDs and reject ambiguous labels consistently for every toolkit", () => {
  const models = [
    { id: "one", label: "Shared" },
    { id: "two", label: "Shared" },
    { id: "shared", label: "Unique" },
  ];
  assert.equal(resolveConfiguredModelId(" SHARED ", models), "shared");
  assert.equal(resolveConfiguredModelId("unique", models), "shared");
  assert.throws(() => resolveConfiguredModelId("Shared", models.slice(0, 2)), /ambiguous/);
  assert.throws(() => resolveConfiguredModelId("missing", models), /Unknown configured model/);
});
function references(text: string) {
  return formatHashlines(text)
    .split("\n")
    .map((line) => line.slice(0, line.indexOf(":")));
}
