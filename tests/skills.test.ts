/** Exercises standard skill parsing and the actual SDK lifecycle, including progressive context and host-access restrictions without a model API call. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type Model, type ModelRequest, type ModelResponse, Runner, Usage } from "@openai/agents";
import { SandboxAgent, shell, skills } from "@openai/agents/sandbox";

import {
  SKILL_WORKSPACE_INSTRUCTIONS,
  skillSandbox,
} from "../src/vibe-prompting/agents/openai-agents/skills.ts";
import {
  createSkillMarkdown,
  readSkillMetadata,
  SkillFormatError,
} from "../src/vibe-prompting/context-system/skills.ts";

test("standard manifests retain multiline descriptions and reject incomplete or unsafe names", () => {
  assert.equal(readSkillMetadata("# Ordinary context\nUse Markdown."), undefined);
  assert.equal(readSkillMetadata("---\ntitle: Notes\n---\nContent"), undefined);
  assert.deepEqual(
    readSkillMetadata(
      "\uFEFF---  \r\n'name': quoted\r\n\"description\": Read notes\r\n--- \r\nInstructions.",
    ),
    { name: "quoted", description: "Read notes" },
  );
  assert.deepEqual(
    readSkillMetadata(
      "---\nname: demo-brief\ndescription: >\n  Use for project updates\n  and demo notes.\n---\nWrite a brief.",
    ),
    { name: "demo-brief", description: "Use for project updates and demo notes." },
  );
  for (const markdown of [
    "---\nname: ../secret\ndescription: Read\n---\nRead.",
    "---\nname: demo\n---\nRead.",
    "---\nname: demo\ndescription: Read\n---\n",
    "---\nname: demo\ndescription: Read",
  ]) {
    assert.throws(() => readSkillMetadata(markdown), SkillFormatError);
  }
});

test("the native SDK advertises metadata first and reads the body only after a tool call", async () => {
  const body = "SECRET_SKILL_BODY: output a three-section demo brief.";
  const requests: ModelRequest[] = [];
  const model = fakeModel((request) => {
    requests.push(request);
    if (requests.length === 1) {
      assert.match(request.systemInstructions!, /demo-brief/);
      assert.match(request.systemInstructions!, /Use for project updates/);
      assert.doesNotMatch(JSON.stringify(request), /SECRET_SKILL_BODY/);
      const path = request.systemInstructions!.match(/(\/[^\s)]+\/SKILL\.md)/)?.[1];
      assert.ok(path, "the SDK advertises a skill file path");
      return toolResponse(`cat ${path}`);
    }
    assert.match(JSON.stringify(request.input), /SECRET_SKILL_BODY/);
    return textResponse("Demo ready.");
  });
  const agent = new SandboxAgent({
    name: "Skills test",
    model,
    baseInstructions: SKILL_WORKSPACE_INSTRUCTIONS,
    capabilities: [
      shell(),
      skills({
        skills: [
          {
            name: "demo-brief",
            description: "Use for project updates",
            content: createSkillMarkdown("demo-brief", "Use for project updates", body),
          },
        ],
      }),
    ],
  });
  const result = await new Runner({ tracingDisabled: true }).run(
    agent,
    "Prepare a project update.",
    { sandbox: skillSandbox() },
  );
  assert.equal(result.finalOutput, "Demo ready.");
  assert.equal(requests.length, 2);
});

test("the local skill reader blocks host paths and arbitrary commands", async () => {
  let call = 0;
  const model = fakeModel((request) => {
    call++;
    if (call === 1) return toolResponse("cat /etc/passwd");
    if (call === 2) {
      assert.match(JSON.stringify(request.input), /not a skill file/);
      return toolResponse("env");
    }
    assert.match(JSON.stringify(request.input), /Only cat/);
    return textResponse("Host access blocked.");
  });
  const agent = new SandboxAgent({
    name: "Restricted reader",
    model,
    capabilities: [
      shell(),
      skills({
        skills: [
          {
            name: "demo",
            description: "Demo",
            content: createSkillMarkdown("demo", "Demo", "Read these instructions."),
          },
        ],
      }),
    ],
  });
  const result = await new Runner({ tracingDisabled: true }).run(agent, "Test access.", {
    sandbox: skillSandbox(),
  });
  assert.equal(result.finalOutput, "Host access blocked.");
});

function fakeModel(respond: (request: ModelRequest) => ModelResponse): Model {
  return {
    async getResponse(request) {
      return respond(request);
    },
    getStreamedResponse() {
      throw new Error("These lifecycle tests use non-streamed model responses.");
    },
  };
}

function toolResponse(cmd: string): ModelResponse {
  return {
    usage: new Usage(),
    output: [
      {
        type: "function_call",
        callId: `read-${cmd}`,
        name: "exec_command",
        arguments: JSON.stringify({ cmd }),
      },
    ],
  };
}

function textResponse(text: string): ModelResponse {
  return {
    usage: new Usage(),
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}
