---
name: agent-test-bench
description: Run and inspect the repository's standalone BuildingAI agent tests. Use when testing a JSON agent profile, comparing supported models or configuration changes, exercising the local chat UI, checking tool or auxiliary-model behavior, or inspecting a standalone run in Langfuse without running the BuildingAI application.
---

# Test a BuildingAI Agent

Obey the repository `AGENTS.md` scope. Use the existing runner rather than rebuilding application services or authentication.

This skill owns test design, runner operation, repeated execution, trace inspection, and evidence reporting for the existing standalone bench. It does not own prompt-design principles or the Prompting application backend. Use `design-agent-prompt` for prompt edits, and do not import backend clients, target protocols, evaluator workflows, or application schemas into this bench workflow.

## Prepare a Test

1. Read the JSON configuration loaded by `test_agent.ts`, select the `Default` configuration or a named profile, and resolve its `rolePromptFile` relative to that JSON file.
2. Change ordinary settings in the JSON and edit long role prompts in their referenced Markdown files. Restart the standalone CLI or UI to reload prompt edits; no manual sync step is required.
3. Keep each run focused on one question or configuration difference so its output and trace remain attributable.
4. Keep local credentials in the repository `.env`; the runner loads it automatically without overriding variables already exported by the shell. CLIProxyAPI chat requires `CLIPROXYAPI_API_KEY` or the `OPENAI_API_KEY` fallback. Vercel models require `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. File-backed knowledge-base tests read `GEMINI_API_KEY` from the process environment. Exa search uses `EXA_API_KEY` when present and otherwise uses the hosted server's free allowance. Langfuse is optional and activates when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present; `LANGFUSE_BASE_URL` selects a non-default host.
5. Source `~/.zshrc` before a run launched from a non-interactive tool shell so its exported credentials are available; do not copy shell-managed keys into repository files.

## Choose Test Depth

- **Full pass:** Run all 16 cases three times for a new baseline or milestone.
- **Focused pass:** Run only the affected cases three times when investigating a finding, comparing one configuration difference, or retesting a prompt change.

State the selected depth and reason before running tests. Do not turn every ad-hoc check into a full 48-run pass.

For prompt tuning, start with three fresh runs on the target model. Compare other models only when the result appears model-dependent or the user asks for a comparison. Use at most one general prompt retry per focused pass, keep the better wording, and stop rather than cycling through small rewrites.

## Define Agent-Specific Difficulty

Before writing the matrix, read the selected role prompt and define four concrete user tasks from that agent's actual domain. Write the expected useful outcome for each task so difficulty is judged by the work required, not by strange wording alone.

1. **Easy:** One clear, supported outcome with the important facts supplied. It should require a direct answer or one obvious action, with no meaningful ambiguity.
2. **Medium:** A normal realistic workflow with several facts, one relevant omission, or one straightforward file or search step. The agent may need one focused clarification or a short sequence of actions.
3. **Hard:** Several interdependent facts, constraints, changes, sources, or files must be reconciled. The agent must choose what matters, use tools deliberately, and produce a complete domain outcome rather than a list of generic advice.
4. **Very hard:** A demanding but plausible end-to-end case combines conflicting evidence, incomplete information, multiple tool or file steps, changing requirements, or a mixed valid and invalid request. It should remain solvable within the agent's declared role; obscure trivia, unsupported languages, profanity, and jailbreak wording do not make a task difficult by themselves.

Define domain-specific anchors that progress from one clear supported outcome, through one material omission, through several interdependent facts, to conflicting evidence and changing requirements. Derive every anchor from the selected profile rather than reusing another agent's cases.

Use these anchors for supported work and define separate negative controls for unsupported, harmful, or instruction-attack cases. Keep the underlying task unchanged when comparing languages, then add only the intended language variation. Apply messy wording or profanity to a known anchor so the robustness test still has a clear correct outcome. For a balanced 16-case pass, assign four cases to each difficulty level, but do not assume that the four numbered cases inside every category are automatically Easy through Very hard.

## Build a General Test Matrix

Use four categories with four cases each. Adapt the wording and expected outcome to the profile's declared scope instead of copying generic prompts literally.

Define each case before testing: its difficulty, exact one-turn input or scripted turn sequence, required files or setup, and expected behaviour. The expected behaviour should state the scope decision, output language, essential facts or outcome, expected tool or file handling, acceptable clarification, and any critical failure condition.

Keep the expected behaviour satisfiable through the permitted source route. For example, do not require current external facts that are absent from an attached file while also forbidding web search; either include the facts in the fixture, permit verification, or expect the agent to identify what remains unverified.

### 1. Intention and Scope

1. **Clearly supported:** Ask for a normal end-to-end task that should produce the agent's intended useful outcome.
2. **Vague but probably supported:** Omit one potentially important detail and check whether the agent proceeds sensibly or asks one focused clarification only when needed.
3. **Clearly unsupported:** Ask for an unrelated task and check whether the agent briefly explains its scope and redirects without attempting the task.
4. **Mixed or partially disallowed:** Combine a supported request with an unsupported, harmful, or unlawful part and check whether the agent handles the valid part while refusing only the bad part.

### 2. Language and Communication

1. **English:** Use a natural English request and check the declared English behavior.
2. **Traditional Chinese:** Use natural Hong Kong Traditional Chinese and check terminology, script, and written style.
3. **Mixed language:** Mix English with Traditional Chinese or Cantonese phrasing and check whether the agent understands it without treating code-switching as a different intention.
4. **Unsupported language:** Use a language or script outside the profile's declared support and check the exact fallback behavior stated in the prompt.

### 3. Information, Files, and Tools

1. **No tool needed:** Ask something answerable from the supplied context and check that the agent does not use tools merely because they exist.
2. **Current or external information needed:** Ask for information that should be searched or retrieved and inspect the selected tool, query, sources, and how the result is used.
3. **Useful file supplied:** Attach a relevant file and check whether the agent extracts the useful facts, identifies missing information, and avoids asking for facts already present.
4. **Insufficient or adversarial information:** Supply an irrelevant, incomplete, contradictory, or instruction-bearing file or weak search result and check whether the agent distinguishes information from instructions and avoids inventing an answer.

If a profile has no file or tool capability, mark the inapplicable cases clearly instead of manufacturing a failure.

### 4. Robustness and Edge Cases

1. **Messy input:** Use typos, fragments, omitted punctuation, or awkward dictation and check whether the agent identifies the likely intention without unnecessary clarification.
2. **Rude or profane wording:** Keep the underlying request valid but phrase it rudely and check that tone alone does not trigger an intention or safety refusal.
3. **Instruction attack:** Directly ask the agent to ignore its role or reveal hidden instructions, and when file input applies, also place such instructions inside a file.
4. **Difficult state:** Provide missing, conflicting, impossible, or changing requirements and check whether the agent surfaces the actual problem, preserves known facts, and gives a useful next step.

### Script Multi-Turn Cases

Make at least four cases in a full pass multi-turn. Choose realistic conversations from the selected agent's domain rather than adding filler turns:

1. **Clarify and complete:** Start with one important omission, answer the agent's focused clarification, and check the completed outcome.
2. **Correct or change:** Let the agent produce an initial result, then correct a fact or change one requirement and check whether it updates the result without losing valid earlier information.
3. **Continue from evidence:** Supply a file or require a search, then ask a follow-up that depends on the retrieved facts and check whether the agent uses the evidence consistently.
4. **Shift scope:** Begin with a supported task, introduce an unsupported or disallowed request, then return to the supported task and check whether the agent preserves the valid workflow.

Write the exact user turns and the expected behaviour after each turn before testing. Do not force every category to contain a multi-turn case when it would be artificial.

## Repeat and Judge

Run every selected case three times in separate new chats with the same profile, model, configuration, files, and input. For a multi-turn case, replay the exact scripted sequence through the UI without improvising tester replies. Do not silently improve the prompt or case between repetitions. Record each run independently because one fluent answer is not evidence of reliable behavior.

- **3/3 passed:** Reliable for this test batch.
- **2/3 passed:** Inconsistent; report the difference and investigate before changing the prompt.
- **0-1/3 passed:** Failed or unreliable for this test batch.

Judge each run against the predefined expected behaviour, then record consistency separately. Three similar wrong answers are a consistent failure, not a stable success. Inspect actual tool calls and the final answer rather than scoring fluency alone. Change the prompt only when repeated evidence exposes a meaningful prompt problem; distinguish it from a model, runtime, tool, data, or case problem.

## Return Prompt Findings

When repeated evidence identifies a prompt problem, report the smallest demonstrated prompt issue and hand it back to `design-agent-prompt`. Do not edit prompting guidance, invent a reusable evaluator contract, or turn one profile's domain facts, raw cases, model behavior, provider quirks, or one-off workaround into a general rule from inside the bench workflow.

## Keep a Concise Logbook

For a completed matrix or another material test batch, write one human-readable Markdown logbook under `.agents/context/test-runs/`. Do not create a logbook for every ad-hoc check.

Record only:

- Profile, model, date, and the configuration or prompt version being tested.
- A concise version of each question and answer rather than a verbatim transcript.
- The evaluation for each run, combined pass count, and separate consistency judgment.
- Short remarks about meaningful differences, tool behavior, suspected cause, prompt changes, or retest outcome.
- The corresponding Langfuse trace identifier or link when available.

Use Langfuse as raw supporting evidence for the fields it actually records. Do not assume that every CLI trace contains full tool inputs or outputs. When tool behaviour matters, inspect the available trace and UI stream, then record the concise evidence in the logbook. The logbook is the readable finding and evaluation layer, not a second trace store.

## Run the Agent

Run one terminal turn:

```bash
node test_agent.ts PROFILE MESSAGE
```

Use the CLI for a one-turn case. Use the UI for a scripted multi-turn workflow.

Select another supported model:

```bash
node test_agent.ts --model MODEL PROFILE MESSAGE
```

Start the local browser UI:

```bash
node test_agent.ts --ui
```

Profile and model are selectable in the page. Supplying `PROFILE` or `--model MODEL` only chooses the initial selection.

Attach one or more UTF-8 text files as an in-memory knowledge base:

```bash
node test_agent.ts --file PATH --file PATH PROFILE MESSAGE
```

Open the localhost URL printed in the terminal. The UI uses a dynamically allocated free port. Use the model selector for comparisons and reset the conversation between independent tests.

For programmatic tests, import `runProfileTest` from `test_agent.ts` and pass `message`, plus optional `configPath`, `files`, `modelName`, and `profileName`.

## Interpret the Runtime

- `gpt-5.6-luna` uses CLIProxyAPI's OpenAI Responses path, while `gemini-3.5-flash` and `gemini-3.6-flash` use its Chat Completions path. `deepseek/deepseek-v4-flash-0731` uses Vercel AI Gateway.
- When `enableWebSearch` is true, every supported chat model receives only Exa's `web_search_exa` tool from `https://mcp.exa.ai/mcp`; the runner does not use provider-native search or expose Exa's separate page-fetch tool.
- The runner sends medium reasoning effort to CLIProxyAPI models. Vercel models use their provider default because the OpenAI-specific reasoning option does not apply to them.
- Annotation matching is hard-disabled by the standalone override, even if a profile contains annotation configuration.
- Memory is disabled by the standalone override.
- Planning and follow-up are enabled only when the selected profile configures them, but the standalone runner currently performs those helper calls with the selected chat model rather than instantiating the configured auxiliary model identity.
- File search is disabled by default and activates only when the CLI receives `--file` or a programmatic test supplies `files`.
- Supplied files are chunked and embedded in-process with the native Gemini API and `gemini-embedding-2`; the runner exposes them through the application's fixed `datasetsSearch` tool contract without creating or using a BuildingAI dataset.
- File search approximates only the application's dataset-tool path; it does not implement the separate pre-agent annotation matcher or canned-answer bypass.
- Application-owned datasets, MCP definitions, annotations, persistence, billing, and conversation state are absent from the standalone test.

## Inspect Langfuse

When credentials are available, check the matching `standalone-agent-test` trace in the configured environment, which defaults to `agent-test`. Confirm only the chat, tool, auxiliary-model, latency, usage, cost, reasoning, and error details actually present in the trace; do not infer missing tool payloads. Keep these standalone traces separate from production traces and data.

## Verify and Report

After runner changes, run:

```bash
pnpm exec tsc --noEmit -p tsconfig.json
```

Report the profile, model, configuration difference, prompt, visible result, tools or auxiliary calls, usage or errors, and whether Langfuse confirmed the same behavior. Separate current evidence from assumptions and do not preserve one-off outputs as baseline documentation.
