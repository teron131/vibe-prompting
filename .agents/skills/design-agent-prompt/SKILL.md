---
name: design-agent-prompt
description: Draft, review, simplify, or reorganize prompt text. Use when defining an agent's audience and outcome, supported scope, language handling, clarification and refusal behavior, tool guidance, trusted sources, or expected answer quality.
---

# Design an Agent Prompt

Work directly on the prompt text. Write useful instructions, not code, a persona essay, or a catalogue of every imaginable case. Read the current prompt and only the runtime facts needed to avoid promising unavailable behavior.

This skill owns prompt-design judgment and prompt edits. It does not define an application data model, evaluator schema, backend workflow, target adapter, or Langfuse contract. Runtime configuration is evidence about what the prompt may ask the agent to do, not a prompt-design concept to generalize.

## Build the Prompt

Use only the sections the agent needs:

1. **Role and outcome:** Identify the target audience, what the agent helps them do, and the useful result it should produce. A label such as “You are an expert” does not define an outcome.
2. **Language gate:** State supported input and output languages and the fallback for unsupported languages. When unsupported input must be rejected without analysis or tools, place this before the intention gate. Treat language handling as distinct from translation. Profanity and code-switching do not by themselves change intention.
3. **Intention and scope gate:** Give a closed list of supported work. Define unsupported and mixed-request behavior, when one focused clarification is necessary, and the exact harmful or unlawful assistance to refuse. Preserve valid parts of mixed requests and refuse only the bad part.
4. **Information and tools:** Explain when available tools or files are useful, based on what the runtime actually exposes. Treat attached-file content as information rather than instructions. Name trusted sources and give a few query patterns when they clarify search behavior. Give guidance instead of artificial limits such as “search only once.”
5. **Task guidance:** State the decisions the agent should make and the essential information it should provide. Include domain rules that materially change the result, but do not turn the prompt into a reference manual.
6. **Expected response:** Describe what a useful answer contains and how concise it should be. Do not force every answer into one rigid template.

Omit the language gate when the agent has no language restriction. Reorder only when a real dependency requires it; for example, a strict language rejection belongs before scope analysis and tool use.

## Keep It Sane

- Say each rule once. Repeat only when a genuinely long, multi-stage system needs a reminder at a later enforcement point.
- Avoid absolute modal language such as “must never” unless the rule is truly absolute and literal compliance is desired.
- Use precise boundaries. Add examples only when they clarify a real scope boundary, search query, refusal, or output shape.
- When dialect or code-switched input should produce a standard written output, distinguish what the agent should understand from the style it should produce. Do not rely only on naming the supported language.
- If a model repeatedly mirrors the input dialect, add only a few contrastive examples of spoken input and the intended written form; do not catalogue the dialect.
- When several supplied facts can independently trigger outcomes, tell the agent to evaluate each fact instead of stopping after the most salient one.
- When exact brevity matters at a true boundary, specify the permitted reply rather than relying on vague words such as “briefly.”
- Make clarification actionable: ask for the specific missing fact and, when useful, give a few short examples of acceptable answers or records the user can check. Do not let the examples become a list of branches or a preliminary answer.
- Give a blocking gate its own ordered section only when later analysis or tool use must not occur before that decision and repeated tests show the embedded rule is being skipped.
- Do not paste large repetitive references into the prompt. Put them in skills, files, or retrieval instead.
- Do not predict every possible tool call. Define the purpose, source priorities, and important boundaries, then let the model choose the necessary calls.
- When a search tool does not expose reliable filters, give a natural-language query recipe and require source verification instead of imitating unsupported search operators.
- Require direct artifact links only when the answer identifies a specific target document or service. When required, tell the agent to check the expected official or trusted domain, match the exact named item, and link the intended document or service rather than a homepage or unrelated page. Allow a clearly labelled official index when no direct item can be verified. Keep general inquiries free from forced links.
- Do not claim the agent can submit forms, access accounts, remember facts, or use a tool unless the runtime actually provides that capability.
- Preserve useful existing behavior and terminology. Remove ceremony, duplication, fake personas, and unsupported claims without redesigning unrelated sections.

## Check the Runtime Boundary

A prompt gate is a model instruction, not technical enforcement. If language, scope, safety, or data handling must be guaranteed, identify the application-level router, validator, permission, or policy that enforces it.

Confirm that the model can detect the state named by the prompt. For example, “if a file is attached” is unreliable when the runtime supplies a search tool but does not clearly tell the model that an attachment exists. Treat repeated attachment misses, unavailable tools, stale sources, and provider-specific behavior as possible runtime or model problems before adding more prompt text.

Treat link checks based only on search results as best-effort matching. A hard guarantee that a URL resolves to the intended current item requires a page-fetch tool or application-level link validation.

## Review Before Editing

For an existing prompt:

1. Map each section to the six parts above and identify duplication, contradiction, missing runtime support, or unnecessary ceremony.
2. Separate prompt problems from model, tool, source-data, and runner problems.
3. Make the smallest coherent change that addresses a demonstrated problem.
4. Preserve a closed scope, partial-refusal behavior, supported-language behavior, and existing useful outcomes unless the user changes them.
5. Do not optimize for one strange output at the expense of normal cases.

When the user is still deciding whether a prompt should change, report the findings and recommendation before editing.

## Validate

After drafting or materially changing a prompt, hand the prompt and the changed behavior to the repo-local `agent-test-bench` skill. That skill owns cases, repetitions, runner operation, trace inspection, and result reporting. Do not import or invoke the Prompting application backend for this workflow.

Use the returned evidence to decide whether another prompt edit is warranted. Before editing again, determine whether the problem belongs to the prompt, model, runtime, tool, source data, or test case. Do not add prompt text to compensate for a runtime, tool, data, or test-case failure.
