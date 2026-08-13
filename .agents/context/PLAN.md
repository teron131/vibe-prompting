# Prompting Plan

## Objective

Deliver a Langfuse-backed application that evaluates and iterates on prompt strings across different Target runtimes without adopting any runtime's agent configuration as the product model.

The baseline product input is prompt text, usually stored in Markdown, plus messages or examples and a requested model. Target implementations own tools, loop mechanics, provider integration, and framework-specific configuration. Langfuse retains the complete evaluation record.

## How to Use This Plan

The sections below are independent work areas rather than sequential stages. Work may move between them as concrete usage exposes the next useful boundary, and a checked item means the behavior has been implemented and proven rather than merely discussed.

## Application Flow

```text
Prompt text + messages/examples + requested model
→ Target implementation executes its runtime
→ Produced messages and best-effort metadata
→ LLM judges inspect observable evidence
→ Evaluator workflow records runs and judgments in Langfuse
→ User or Operator decides whether to edit the prompt
```

## Work Areas

- [ ] Coding-agent baseline
- [ ] Configuration and model clients
- [ ] Target runtime adapters
- [ ] LLM judges and score contracts
- [ ] Langfuse execution and persistence
- [ ] Evaluator workflow orchestration
- [ ] Prompt Operator and persistence
- [ ] Minimal UI and optional external interfaces

These area-level boxes represent complete usable capabilities; completed sub-items do not imply that the whole area is finished.

## Coding-Agent Baseline

The existing manual workflow remains outside the application:

```text
design-agent-prompt
→ coding agent edits prompt Markdown
→ agent-test-bench runs the existing standalone agent
→ coding agent reviews the evidence and decides whether to edit again
```

### Work

- [ ] Keep `design-agent-prompt` focused on prompt-design judgment and direct prompt edits.
- [ ] Keep `agent-test-bench` focused on cases, runner operation, repetitions, trace inspection, and reporting.
- [ ] Keep the standalone runner and its configuration independent from the Prompting application.
- [ ] Do not import application clients, Target protocols, evaluators, schemas, or workflows into either skill.
- [ ] Do not import the skills, standalone runner, or its profile format into the application backend.

This baseline may be used for comparison or manual supervision, but it is not an application dependency.

## Configuration and Model Clients

### Boundary

- Load provider configuration from the environment.
- Load the user-editable model catalogue from private `.config.yaml`, with `.config.yaml.example` as its committed template.
- Expose native LangChain chat and embedding clients without leaking provider routing into evaluation logic.
- Keep model selection explicit and preserve the actual model identity used.
- Treat external tools as independent clients or tools rather than Target or evaluator policy.

### Work

- [ ] Load provider credentials and configurable base URLs from the environment.
- [ ] Load the user-editable chat and embedding model catalogue.
- [ ] Route each requested chat model through its preferred configured platform, using the generic endpoint only when the preferred credentials are unavailable.
- [ ] Provide the configured embedding client.
- [ ] Make selected external tools available through their supported remote interface without attaching them to any workflow by default.
- [ ] Keep client construction independently inspectable without executing a model call.

### Proof

- [ ] Each configured chat model can complete a focused live smoke.
- [ ] The embedding client can produce one vector with the configured model.
- [ ] External tool discovery returns only the intended tools.
- [ ] Missing optional providers do not prevent unrelated configured clients from loading.
- [ ] No client imports the repo-local skills or standalone bench.

## Target Runtime Adapters

### Boundary

The stable required facts are message content and requested or actual model identity. Runtime-specific tools, loop mechanics, configuration, structured output, and optional metadata remain native to each adapter.

The required input is:

- A native message sequence for the supported runtime.
- A requested model identifier configured on the adapter.

The required output is:

- The messages produced by the run, preserving assistant tool calls and tool-result messages when the runtime exposes them.
- The model identifier actually used.

Usage, latency, trace references, provider details, and other metadata are best effort. Execution failures must surface, but an adapter does not manufacture metadata its runtime cannot expose.

### Work

- [x] Implement concrete AI SDK and LangChain adapters rather than a speculative universal agent protocol.
- [x] Preserve native AI SDK and LangChain messages, tool calls, and tool results.
- [x] Keep structured output as an invocation mode rather than another adapter family.
- [x] Capture requested and actual model identity with best-effort runtime metadata.
- [ ] Prove a complete application-owned Target run with supplied prompt text and messages.
- [ ] Surface execution failures with their original causes through the eventual public evaluation command.

### Non-goals

- A universal agent configuration or tool schema.
- Adapters for hypothetical frameworks.
- Compatibility with the standalone runner's internal profile format.
- Evaluator logic, prompt editing, persistence, or filesystem tools inside Target adapters.

### Proof

- [ ] One headless command runs supplied prompt text and messages through a Target adapter.
- [ ] The output contains produced messages and the actual model identifier.
- [ ] Target-specific tools and loop mechanics remain inside the implementation.
- [ ] Another supported adapter can replace the first without changing judge concepts.

## LLM Judges and Score Contracts

### Boundary

- Judges score already-produced inputs and outputs independently of Target execution.
- Comparative judges use boolean, categorical, or numeric structured outputs.
- Text scores hold standalone qualitative feedback, corrections hold proposed replacement output, and score comments and evidence explain either result.
- Use-case-specific instructions, categories, examples, and expectations remain configurable.
- Blocking and passing behavior belongs to workflow policy rather than another judge family.
- Judge classes do not own Langfuse clients, experiments, score persistence, or telemetry lifecycle.

### Work

- [x] Define `LlmJudge` independently from Target execution and Langfuse experiment orchestration.
- [x] Provide boolean, categorical, and numeric judge classes whose schemas align with Langfuse score types.
- [x] Preserve judge reasoning as the Langfuse score comment and evidence as score metadata.
- [x] Keep blocking or passing policy outside the judge class hierarchy.
- [x] Add structured result fields only when they have clear comparison or routing consumers.
- [x] Keep use-case-specific criteria and examples in judge input or configuration.
- [x] Accept a non-empty invocation-supplied criterion list with Boolean, categorical, numeric, text, and correction score contracts.
- [ ] Select the first application-specific judges and evaluation criteria from a concrete prompt-evaluation case.
- [ ] Avoid semantic subclasses such as `LanguageGate` or `IntentionGate` until repeated usage proves that they own behavior beyond configuration.

### Primitive Demo

- [x] Run a Gemini correctness judge against `1 + 1 = 3` and receive `false` with reasoning.
- [x] Run a Gemini English-language judge against a Japanese response and receive `false` with reasoning.
- [x] Run multiple fixed examples through the same experiment invocation.
- [x] Confirm that evaluation does not modify the candidate prompt or response.

## Langfuse Execution and Persistence

### Boundary

- Langfuse owns published datasets, dataset items, experiments, runs, traces, observations, scores, annotations, comparisons, and complete run history.
- A Langfuse-backed runner converts judge results into Langfuse SDK evaluator results and owns client, telemetry, experiment, score-writing, flush, and shutdown lifecycle.
- Langfuse is enabled by default once the runner exists.
- One process-wide `LANGFUSE_ENABLED=false` opt-out selects explicit local-only execution.
- Enabled operation fails at startup when required Langfuse credentials are missing.
- Local files copy only prompt content, Langfuse references, or working evidence that later workflows prove they need.

### Work

- [x] Initialize the Langfuse client and OpenTelemetry trace processor.
- [x] Run the primitive Gemini judge demo through a Langfuse SDK experiment evaluator.
- [x] Persist judge comments and evidence metadata with their scores.
- [x] Verify through the Langfuse API that both primitive scores were stored as boolean `false` values.
- [x] Add a reusable judge-to-Langfuse evaluator conversion instead of rewriting translation at each usage site.
- [x] Add a Langfuse-backed runner that owns experiments, telemetry, score persistence, flushing, and shutdown.
- [ ] Add an explicit local runner selected only by `LANGFUSE_ENABLED=false`.
- [ ] Validate Langfuse credentials at startup whenever Langfuse is enabled.
- [ ] Record prompt text, messages, requested and actual Target model, judge identity, judge instructions, output, and available trace evidence.
- [ ] Support an optional Langfuse dataset when reusable cases become useful.
- [ ] Keep full local duplication and bidirectional synchronization out of scope.

### Proof

- [x] Langfuse records retain the correct boolean data type and supporting comment for the primitive examples.
- [ ] Categorical, numeric, text, and correction results retain their correct Langfuse score types and constraints.
- [ ] The same judge runs through either the Langfuse-backed runner or explicit local-only runner without importing Langfuse itself.
- [ ] Missing Langfuse credentials fail clearly by default, while `LANGFUSE_ENABLED=false` runs without remote persistence.
- [ ] One headless command evaluates supplied prompt text through a Target and records the run in Langfuse.

## Evaluator Workflow Orchestration

### Boundary

- The evaluator workflow executes cases, invokes Target adapters and judges, and sends results to the selected runner.
- LangGraph owns explicit stages, state, routing, parallelism, and bounded revisits when those behaviors are concrete.
- LangChain owns model invocation, structured output, middleware, and agent helpers where useful.
- Models remain an available pool rather than being permanently assigned to roles.
- Exa remains optional for verification because shared retrieval with the Target does not provide independent evidence.

### Work

- [ ] Define the first end-to-end state from a concrete prompt, example, Target run, and judge result.
- [x] Implement the first evaluator pass as a LangGraph workflow while leaving future stages and routing uncommitted.
- [ ] Make repetitions, model assignments, concurrency, and spend limits explicit run inputs when introduced.
- [ ] Add aggregation, weighting, hard gates, missing-evidence states, and attribution separately only when real comparisons require them.
- [x] Keep every use-case-specific criterion in per-invocation judge configuration rather than the graph contract.
- [ ] Keep models assignable per run rather than permanently binding a model to a role.
- [ ] Keep Exa available but unattached until a verifier has an evidence need it can actually satisfy.

### First End-to-End Slice

```text
Prompt text + one example + requested model
→ Application-owned Target
→ One LLM judge returns a structured result
→ Selected runner records or returns the result
→ Target trace and score are inspected against the observable evidence
```

### Proof

- [ ] Evaluator outputs remain attributable to judge instructions, model version, input, output, and observable evidence.
- [ ] The same judge can score outputs from both supported Target runtimes without depending on their internal configuration.
- [ ] Every added repetition, aggregation, gate, or workflow branch has a demonstrated decision-making use.

## Prompt Operator and Persistence

### Trigger

Build this area after evaluation usage shows that users want the application to create or edit prompt text directly.

### Boundary

- The Operator is a neutral worker that creates or edits prompt strings under user direction.
- The Operator is separate from evaluation and may make non-improvement edits when explicitly requested.
- Direct prompt read, write, and patch operations are preferred when the application owns persistence.
- Workspace-scoped file operations are secondary support for existing local Markdown workflows.
- Target tools, runtime source code, arbitrary repository navigation, and general shell execution remain outside the Operator.

### Work

- [ ] Implement the smallest agent or tool loop required by the editing workflow.
- [ ] Prefer direct prompt read, write, and patch operations when the application owns persistence.
- [ ] Add workspace-scoped file operations only when users must work with existing local Markdown files.
- [ ] Let users inspect prompt changes before continuing.
- [ ] Add simple stacked prompt history and restore only when application-managed reversion is needed.
- [ ] Invoke evaluation through the same backend rather than duplicating it inside the Operator.

### Proof

- [ ] The Operator can edit a prompt without knowing the Target runtime's framework configuration.
- [ ] Filesystem access, if present, cannot escape the configured prompt workspace.
- [ ] Prompt history, if present, supports inspection and restore without workflow-approval or branch-management concepts.
- [ ] Evaluation remains independently callable without the Operator.

## Minimal UI and Optional External Interfaces

### Boundary

- Nontechnical users receive a low-navigation prompt workflow while detailed observability remains in Langfuse.
- Script, UI, and optional external-agent interfaces call the same backend.
- MCP or another external-agent interface is added only when the headless command or backend API is insufficient.
- External coding agents use their own editing tools rather than requiring a bundled coding-agent runtime.

### Work

- [ ] Provide a chat or form flow for entering prompt text and optional examples.
- [ ] Let users select available models and start evaluation with clear cost implications.
- [ ] Show concise judge findings, flagged examples, prompt changes, and comparison evidence.
- [ ] Deep-link to corresponding Langfuse experiments and traces.
- [ ] Add MCP or another external-agent interface only when the backend API is insufficient.

### Non-goals

- Rebuilding Langfuse dataset management, evaluator administration, traces, annotations, dashboards, or score analytics.
- Duplicating evaluation or prompt-editing logic in the UI or MCP layer.
- Bundling a full coding-agent runtime for external agents that already have one.

### Proof

- [ ] A nontechnical user can submit, evaluate, and revise a prompt without understanding Target runtime configuration.
- [ ] Detailed evidence remains available in Langfuse.
- [ ] UI, script, and external-agent runs remain comparable through the same backend.

## Cross-Area Verification

- [ ] Complete one manual prompt edit and standalone bench run without importing application code.
- [ ] Smoke each configured client boundary independently.
- [ ] Run one prompt and message sequence through each public Target adapter.
- [ ] Prove each judge or workflow feature through a concrete comparison need.
- [ ] Verify persisted Langfuse traces and scores rather than relying only on local formatted output.
- [ ] Demonstrate one prompt edit and one history-preserving restore if application persistence is built.
- [ ] Complete one nontechnical prompt-to-evidence workflow if the UI is built.
- [ ] Complete one external-agent call only if an external interface is built.

Do not add broad test suites that freeze private module shape. Verify observable Target behavior, judge evidence, Langfuse records, and user-visible outcomes.

## Open Decisions

- [ ] Choose repetitions, judge combinations, concurrency, aggregation, and spend limits from real run evidence.
- [ ] Decide when local example strings should become reusable Langfuse datasets.
- [ ] Choose Langfuse Cloud or self-hosting from access, cost, data, and operational requirements.
- [ ] Decide whether the Operator needs application-owned prompt storage or scoped local Markdown tools.
- [ ] Select the UI framework and hosting model.
- [ ] Decide whether MCP is necessary after the headless command and backend API are used.
