# Prompting Plan

## Objective

Deliver a Langfuse-backed application that evaluates and iterates on prompt strings across different Target runtimes without adopting any runtime's agent configuration as the product model.

The baseline product input is prompt text, usually stored in Markdown, plus messages or examples and a requested model. Target implementations own tools, loop mechanics, provider integration, and framework-specific configuration. Langfuse retains the complete evaluation record.

## Separate Coding-Agent Baseline

The existing manual workflow remains outside the application:

```text
design-agent-prompt
→ coding agent edits prompt Markdown
→ agent-test-bench runs the existing standalone agent
→ coding agent reviews the evidence and decides whether to edit again
```

- [ ] Keep `design-agent-prompt` focused on prompt-design judgment and direct prompt edits.
- [ ] Keep `agent-test-bench` focused on cases, runner operation, repetitions, trace inspection, and reporting.
- [ ] Keep the standalone runner and its configuration independent from the Prompting application.
- [ ] Do not import application clients, Target protocols, evaluators, schemas, or workflows into either skill.
- [ ] Do not import the skills, standalone runner, or its profile format into the application backend.

This baseline may be used for comparison or manual supervision, but it is not an application stage or dependency.

## Application Flow

```text
Prompt text + messages/examples + requested model
→ Target implementation executes its runtime
→ Produced messages and best-effort metadata
→ Evaluators inspect observable evidence
→ Evaluator workflow records runs and judgments in Langfuse
→ User or Operator decides whether to edit the prompt
```

## Stage Overview

- [ ] Stage 1 — Configuration and Clients
- [ ] Stage 2 — Target Protocol and Runtime
- [ ] Stage 3 — Evaluator Workflow
- [ ] Stage 4 — Prompt Operator and Persistence
- [ ] Stage 5 — Minimal UI and Optional External Interface

## Core Boundaries

### Prompt

- Is a string consumed by a Target runtime.
- May be provided directly or loaded from Markdown.
- Does not require a universal profile, artifact manifest, or storage schema.
- Remains readable and directly editable outside the application.

### Model clients

- Load provider configuration from the environment.
- Expose LangChain chat and embedding clients without leaking provider routing into evaluation logic.
- Keep model selection explicit and preserve the actual model identity used.
- Treat external tools as independent clients or tools rather than Target or evaluator policy.

### Target protocol

The required input is:

- Prompt text.
- A normalized message sequence, including structured content parts when needed.
- A requested model identifier.

The required output is:

- The messages produced by the run, preserving assistant tool calls and tool-result messages when the runtime exposes them.
- The model identifier actually used.

Usage, latency, trace references, provider details, and other metadata are best effort. Execution failures must surface, but a Target implementation does not manufacture metadata its runtime cannot expose.

The Target owns provider calls, tools, loop mechanics, and runtime-specific configuration. The protocol must not encode the configuration shape of the standalone bench or any other agent framework.

### Evaluation

- Scores already-produced inputs and outputs independently of Target execution.
- May use deterministic code, model-backed judgment, or a bounded combination.
- Keeps evaluator instructions and result shapes provisional until observed runs justify stable contracts.
- Does not edit prompts or own Langfuse experiment lifecycle.

### Evaluator workflow

- Executes cases, invokes Target implementations and evaluators, and records results in Langfuse.
- Uses LangGraph for explicit workflow stages, state, routing, parallelism, and bounded revisits when those behaviors are present.
- Uses LangChain for model invocation, structured output, middleware, and agent helpers where useful.
- Keeps use-case-specific criteria in configuration rather than hard-coding universal intention, language, scope, or tool rules.

### Operator

- Is a later neutral worker that creates or edits prompt strings under user direction.
- Is separate from evaluation and may make non-improvement edits when explicitly requested.
- Uses a narrow prompt persistence interface when the application owns storage.
- Receives scoped file tools only when local Markdown workflows require filesystem access.
- Does not require a general coding-agent runtime, arbitrary repository navigation, or shell access.

### Langfuse

- Owns published datasets and dataset items.
- Owns experiments, runs, traces, observations, scores, annotations, comparisons, and complete run history.
- Receives the prompt, inputs, outputs, model identities, evaluator instructions, and other reproducibility facts available for each run.

Local files should copy only prompt content, Langfuse references, or working evidence that later workflows prove they need. Do not add two-way synchronization.

## Stage 1 — Configuration and Clients

### Goal

Provide application-owned LangChain clients and environment configuration without coupling them to a Target, evaluator, skill, or standalone runner.

### Deliverables

- [ ] Load provider credentials and configurable base URLs from the environment.
- [ ] Load the user-editable chat and embedding model catalogue from private `.config.yaml`, with `.config.yaml.example` as its committed template.
- [ ] Route each requested chat model through its preferred configured platform, using the generic endpoint only when the preferred credentials are unavailable.
- [ ] Provide the configured embedding client.
- [ ] Make selected external tools available through their supported remote interface without attaching them to any workflow by default.
- [ ] Keep client construction independently inspectable without executing a model call.

### Acceptance criteria

- [ ] Each configured chat model can complete a focused live smoke.
- [ ] The embedding client can produce one vector with the configured model.
- [ ] External tool discovery returns only the intended tools.
- [ ] Missing optional providers do not prevent unrelated configured clients from loading.
- [ ] No client imports the repo-local skills or standalone bench.

## Stage 2 — Target Protocol and Runtime

### Goal

Define the smallest application-owned execution boundary for running prompt text through an arbitrary chat pipeline.

### Deliverables

- [ ] Define the minimal Target input and output described above.
- [ ] Keep message content and requested or actual model identity as the stable required facts.
- [ ] Preserve tool-call and tool-result messages when the runtime exposes them.
- [ ] Capture optional metadata on a best-effort basis without making it portable by fiction.
- [ ] Implement one Target using the application clients without depending on the standalone bench.
- [ ] Surface execution failures with their original causes.

### Non-goals

- A universal agent configuration or tool schema.
- Adapters for hypothetical frameworks.
- Evaluator logic, prompt editing, persistence, or filesystem tools.
- Compatibility with the standalone runner's internal profile format.

### Acceptance criteria

- [ ] One headless command runs supplied prompt text and messages through the application-owned Target.
- [ ] The Target can be replaced without changing prompt or evaluator concepts.
- [ ] The output contains produced messages and the actual model identifier.
- [ ] Target-specific tools and loop mechanics remain inside the implementation.

## Stage 3 — Evaluator Workflow

### Goal

Build the smallest repeatable Langfuse-backed evaluation path, then extract reusable evaluator objects and workflow stages from demonstrated needs.

### First vertical slice

```text
Prompt text + one example + requested model
→ Application-owned Target
→ One provisional evaluator
→ Target and evaluator activity recorded in Langfuse
→ Judgment inspected against the observable evidence
```

### Deliverables

- [ ] Define evaluators independently from Target execution and Langfuse experiment orchestration.
- [ ] Start with one deterministic or model-backed judgment useful for a selected case.
- [ ] Record the prompt, messages, requested and actual Target model, evaluator identity, evaluator instructions, output, and available trace evidence in Langfuse.
- [ ] Add structured result fields only when they have clear comparison or routing consumers.
- [ ] Keep use-case-specific criteria and examples in evaluator input or configuration.
- [ ] Keep Exa optional for verification; shared retrieval may corroborate a Target run but does not provide independent evidence.
- [ ] Support multiple examples or an optional Langfuse dataset when repeated cases become useful.
- [ ] Make repetitions, model assignments, concurrency, and spend limits explicit run inputs when introduced.
- [ ] Add aggregation, weighting, hard gates, missing-evidence states, and attribution separately only when real comparisons require them.
- [ ] Implement the end-to-end evaluator as a LangGraph workflow once its stages and state are concrete.
- [ ] Keep models as an available pool rather than permanently assigning one model to one role.

### Acceptance criteria

- [ ] One headless command evaluates supplied prompt text through the Target and records the run in Langfuse.
- [ ] Evaluator outputs remain attributable to their instructions, model or code version, input, and observable evidence.
- [ ] Evaluation does not modify the prompt.
- [ ] The same evaluator can score outputs from another Target without depending on either runtime's internal configuration.
- [ ] Every added repetition, aggregation, gate, or workflow branch has a demonstrated decision-making use.

## Stage 4 — Prompt Operator and Persistence

### Trigger

Begin after the evaluation backend shows that users want the application to create or edit prompt text directly.

### Goal

Let a neutral Operator edit prompt strings under user direction and make reversions practical without turning Prompting into a coding-agent runtime.

### Deliverables

- [ ] Implement the Operator with the smallest agent or tool loop the editing workflow requires.
- [ ] Prefer direct prompt read, write, and patch operations when the application owns persistence.
- [ ] Add workspace-scoped file operations only when users must work with existing local Markdown files.
- [ ] Keep Target tools, runtime source code, arbitrary repository navigation, and general shell execution outside the Operator.
- [ ] Let users inspect prompt changes before continuing.
- [ ] Add simple stacked prompt history and restore only when application-managed reversion is needed.
- [ ] Invoke evaluation through the Stage 3 backend rather than duplicating it inside the Operator.

### Acceptance criteria

- [ ] The Operator can edit a prompt without knowing the Target runtime's framework configuration.
- [ ] Filesystem access, if present, cannot escape the configured prompt workspace.
- [ ] Prompt history, if present, supports inspection and restore without workflow-approval or branch-management concepts.
- [ ] Evaluation remains independently callable without the Operator.

## Stage 5 — Minimal UI and Optional External Interface

### Goal

Serve nontechnical users through a low-navigation prompt workflow while keeping detailed observability in Langfuse.

### Deliverables

- [ ] Provide a chat or form flow for entering prompt text and optional examples.
- [ ] Let users select available models and start evaluation with clear cost implications.
- [ ] Show concise evaluator findings, flagged examples, prompt changes, and comparison evidence.
- [ ] Deep-link to corresponding Langfuse experiments and traces.
- [ ] Add MCP or another external-agent interface only when the headless command or backend API is insufficient.
- [ ] Let external coding agents use their own editing tools and call the same evaluation backend.

### Non-goals

- Rebuilding Langfuse dataset management, evaluator administration, traces, annotations, dashboards, or score analytics.
- Duplicating evaluation or prompt-editing logic in the UI or MCP layer.
- Bundling a full coding-agent runtime for external agents that already have one.

### Acceptance criteria

- [ ] A nontechnical user can submit, evaluate, and revise a prompt without understanding Target runtime configuration.
- [ ] Detailed evidence remains available in Langfuse.
- [ ] UI, script, and external-agent runs remain comparable through the same backend.

## Verification Strategy

- [ ] Baseline: complete one manual prompt edit and standalone bench run without importing application code.
- [ ] Stage 1: smoke each configured client boundary independently.
- [ ] Stage 2: run one prompt and message sequence through the public Target boundary.
- [ ] Stage 3: prove each evaluator or workflow feature through the public evaluation command and a concrete comparison need.
- [ ] Stage 4: demonstrate one prompt edit and, if implemented, one history-preserving restore.
- [ ] Stage 5: complete one nontechnical prompt-to-evidence workflow and one external-agent call only if those interfaces are built.

Do not add broad test suites that freeze private module shape. Verify observable Target behavior, evaluator evidence, Langfuse records, and user-visible outcomes.

## Deferred Decisions

- [ ] Select the first provisional evaluator from a concrete Stage 3 case.
- [ ] Choose repetitions, judge combinations, concurrency, aggregation, and spend limits from real run evidence.
- [ ] Decide when example strings should become reusable Langfuse datasets.
- [ ] Choose Langfuse Cloud or self-hosting from access, cost, data, and operational requirements.
- [ ] Decide whether the Operator needs application-owned prompt storage or scoped local Markdown tools.
- [ ] Select the UI framework and hosting model.
- [ ] Decide whether MCP is necessary after the headless command and backend API are used.

## Immediate Sequence

- [ ] Keep the coding-agent skills and standalone bench isolated as the manual baseline.
- [ ] Review the implemented configuration and client boundary before extending it.
- [ ] Define and prove the minimal application-owned Target protocol.
- [ ] Choose one prompt, example, and provisional judgment for the first evaluator workflow.
- [ ] Review real evidence before stabilizing evaluator schemas or adding workflow branches.
- [ ] Keep Operator, filesystem tools, persistence, UI, and external-agent work deferred until their stages are earned.
