# Prompting Plan

## Objective

Deliver a Langfuse-backed workflow that turns ordinary user intent, optional examples or datasets, and a local Agent Profile into structured evaluation evidence and reviewable profile changes.

The workflow must serve nontechnical users through a built-in Operator and remain callable by external coding agents. Local JSON, YAML, and Markdown artifacts stay readable and editable; Langfuse retains the complete evaluation record.

## Product Contract

The default journey is:

```text
Describe the agent in chat and optionally provide examples or a dataset
→ Create or edit the local JSON Agent Profile and Markdown prompt
→ Select models from the available pool
→ Run the Evaluator Agent against the Target Agent
→ Review checkpoint scores, hard gates, and concrete evidence
→ Ask the Operator to edit the current Agent Profile
→ Record the edit batch as an immutable artifact revision
→ Run a focused comparison
→ Continue from the current revision or revert to an earlier one when needed
```

The same backend contracts must support the headless workflow, future UI, and any later external-agent interface.

## Stage Overview

- [ ] Stage 1 — Agent Profile, Checkpoint Contracts, and Skills
- [ ] Stage 2 — Langfuse-Centric Evaluation Backend
- [ ] Stage 3 — Operator Revision Workflow
- [ ] Stage 4 — Minimal User Interface
- [ ] Stage 5 — Optional External Agent Interface

## System Boundaries

### Operator

- Uses a bounded LangChain ReAct loop rather than a general coding-agent runtime.
- Converts freestyle chat and optional example strings or datasets into a draft Agent Profile and evaluation inputs.
- Follows user instructions through workspace-root-bounded list, read, write, patch, and diff tools and may invoke evaluation-specific tools when relevant.
- May revise prompt text, tool selection and descriptions, model settings, and loop limits.
- Is a neutral worker rather than an optimizer and may perform non-improvement actions when the user explicitly requests them.
- Does not receive general shell access or arbitrary repository tools in the baseline.
- Does not modify tool implementations or arbitrary Target Agent source code.

### Evaluator Agent

- Runs an observable, repeatable, bounded, agentic evaluation pipeline.
- Uses LangGraph for executable state, conditional transitions, and bounded revisits.
- Allows graph nodes to be deterministic functions, Target Agent adapter calls, aggregators, or LLM-backed evaluators.
- Uses LangChain selectively inside nodes that benefit from model invocation or structured-output helpers; it does not own the workflow.
- Invokes Langfuse's Experiment Runner as a coarse workflow operation so one evaluation job may contain many target executions and bounded follow-up experiments.
- Executes cases, gathers traces, applies deterministic checks and structured model judgments, aggregates results, and publishes them to Langfuse.
- May branch or revisit a focused stage when evidence is ambiguous, subject to explicit budgets and stop conditions.
- Records the exact artifact revision and content hash used by every experiment it coordinates.
- Keeps evaluator definitions reusable while project-specific criteria, models, weights, and gate policy arrive through configuration or run input.

### Evaluation capability

- Owns reusable evaluator definitions, checkpoint and result schemas, and model-judge prompts.
- Scores already-produced inputs and outputs independently of the Evaluator Agent.
- Does not own Target Agent execution, Langfuse experiment lifecycle, graph routing, workflow state, or bounded revisit policy.

### Target Agent

- Is the ordinary chat and tool-loop agent under evaluation.
- Is reached through an agent-framework-agnostic adapter.
- Owns provider calls, tool implementations, and loop mechanics behind its adapter.
- Uses the current TypeScript standalone runtime as the default adapter, not as the universal architecture.

### Target Agent adapter

Each adapter is configured with the Target Agent's prompt, tools, and loop policy. Its required per-run input is:

- An OpenAI-style normalized message sequence, including structured content parts when needed.
- A requested model identifier.

Its required output is:

- The messages produced by the run, preserving assistant tool calls and tool-result messages when the underlying agent exposes them.
- The model identifier actually used.

Usage, latency, trace references, provider details, and other metadata are best effort and optional. Execution failures must still surface, but an adapter is not required to manufacture metadata its underlying agent does not expose.

The contract preserves OpenAI-style message semantics without importing one provider's complete wire format. The default ToolLoop adapter wraps the existing standalone runtime; LangChain, Pi, remote OpenAI-compatible agents, or other implementations may provide the same boundary.

### Artifact ownership

The workspace boundary owns recognized artifact locations and their JSON, YAML, and Markdown I/O. It imports domain schemas from their owning modules rather than redefining them, and it does not own evaluation policy or agent behavior.

Local project artifacts own:

- Structured Agent Profile configuration in JSON.
- Long prompts in referenced Markdown files.
- Editable checkpoint definitions and examples.
- A linear parent-linked history of complete immutable artifact revisions and one current revision pointer.
- A small manifest of Langfuse project, dataset, experiment, run, and trace references.
- Selective evaluation snapshots needed for continued local work.

Langfuse owns:

- Complete datasets and dataset items once published.
- Experiments, runs, traces, and observations.
- Checkpoint and aggregate scores.
- Prompt versions or labels when used.
- Human annotations, comparisons, and complete run history.

Do not add two-way synchronization. Local definitions publish into runs; local snapshots are derived working evidence, not a second complete evaluation database.

## Stage 1 — Agent Profile, Checkpoint Contracts, and Skills

### Goal

Turn recurring skill guidance into canonical local artifacts and an executable checkpoint vocabulary without forcing every agent into one rubric.

### Deliverables

- [ ] Define one canonical `AgentProfile` schema, replacing any parallel prompt-only profile concept.
- [ ] Keep structured settings in JSON or YAML and long role prompts in referenced Markdown files, following the current `agent_config.json` and `rolePromptFile` pattern.
- [ ] Define the canonical reusable `EvaluatorDefinition` contract.
- [ ] Define the canonical `CheckpointDefinition` schema.
- [ ] Define the canonical `TestCase` schema for single-turn, multi-turn, file-backed, and tool-using cases.
- [ ] Define the canonical `EvaluationPlan` schema, including model-pool assignments and budgets.
- [ ] Define the canonical `CheckpointResult` schema.
- [ ] Define the canonical `FailureAttribution` schema.
- [ ] Define the canonical selective `EvaluationSnapshot` schema.
- [ ] Add the minimal workspace boundary for loading and writing recognized JSON, YAML, and Markdown artifacts.
- [ ] Define the minimal artifact revision manifest with revision ID, parent revision ID, timestamp, content hash, and optional restored-from revision ID.
- [ ] Store complete immutable snapshots in a linear revision history and expose current, history, diff, and revert operations.
- [ ] Derive an editable default checkpoint pack from `design-agent-prompt` and `agent-test-bench`.
- [ ] Update both skills to produce and consume the canonical schemas and scoring vocabulary.
- [ ] Support user-supplied example strings, generated draft cases, and optional Langfuse dataset references without requiring a dataset for onboarding.

### Agent Profile contract

The editable profile may contain:

- Markdown prompt reference.
- Evaluator definition and checkpoint pack references.
- Supported languages, scope, and response policy.
- Enabled tools and user-facing tool descriptions.
- Model selection or allowed model pool.
- Loop and step limits.

The Evaluation Plan owns example strings, canonical cases or an optional Langfuse dataset reference, plus model-role assignments, repetitions, concurrency, and budgets.

Tool implementations and arbitrary application code remain outside the profile.

### Checkpoint definition contract

Each checkpoint is a project-specific configured use of a reusable evaluator. Its definition must include:

- Stable identifier and concise name.
- Evaluator identifier, criteria, and the question being answered.
- Method: deterministic code, model judgment, or a bounded combination.
- Applicability: `required`, `scored`, or `not_applicable` for the project.
- Optional weight and hard-gate status.
- Evidence inputs and scoring anchors.
- Evaluator version or prompt reference.

### Checkpoint result contract

Each result must include:

- Checkpoint identifier.
- `fail`, `partial`, `pass`, `unknown`, or `not_applicable`.
- Numeric projection of `0`, `0.5`, `1`, or exclusion from aggregation for `unknown` and `not_applicable`.
- Concise evidence-backed reason.
- Relevant output, trace, or tool-event references.
- Suspected owner: profile, model, runtime, tool, data, case, or unclear.
- Evaluator model and version.

### Editable default checkpoint pack

- Intention and useful outcome.
- Supported language behavior.
- Response scope and refusal boundary.
- Tool selection, ordering, and appropriate non-use.
- File and source routing when applicable.
- Clarification behavior.
- Completeness of independently relevant facts.
- Contradiction and unnecessary prompt duplication.
- Regression and test-specific overfitting for profile changes.

Each project may revise the defaults and mark irrelevant checkpoints `not_applicable`.

### Acceptance criteria

- [ ] A review performed from the current skills can be represented without losing its important judgment or evidence.
- [ ] The JSON, YAML, and Markdown artifacts remain understandable without implementation code.
- [ ] Checkpoints distinguish required gates, weighted scores, and inapplicable aspects.
- [ ] Missing evidence produces `unknown` rather than a guessed score or `not_applicable`.
- [ ] `not_applicable` does not lower aggregate scores.
- [ ] Hard-gate failures cannot be hidden by a high average.
- [ ] The worked example starts from freestyle intent and optional examples rather than requiring a prepared dataset.

## Stage 2 — Langfuse-Centric Evaluation Backend

### Goal

Build the Evaluator Agent that runs real Target Agents through the separate evaluation capability, produces structured multi-aspect evidence, and records comparable experiments in Langfuse without changing Agent Profile files.

### Pipeline

```text
Load Agent Profile, checkpoints, examples, and model pool
→ Resolve an evaluation-job plan and budgets
→ Load example strings or a Langfuse dataset
→ Invoke the Langfuse Experiment Runner with the Target Agent adapter and configured evaluators
→ Let Langfuse execute cases and repetitions with concurrency, tracing, and error isolation
→ Inspect item scores, run scores, produced messages, and available metadata
→ Launch a bounded focused experiment for selected ambiguous or failed evidence when warranted
→ Aggregate hard gates and weighted scores
→ Write a selective local Evaluation Snapshot
```

### Deliverables

- [ ] Establish and validate the framework-agnostic Target Agent adapter contract.
- [ ] Implement the existing TypeScript standalone tool-loop runtime as the default adapter.
- [ ] Define the Evaluator Agent's LangGraph state, generic nodes, conditional transitions, budgets, and stop conditions.
- [ ] Define reusable evaluator objects such as intention and language evaluators whose specific criteria arrive through checkpoint configuration.
- [ ] Keep deterministic evaluators independent of LangChain and use LangChain only for evaluator nodes that require model-backed judgment.
- [ ] Support ordinary example strings as the smallest input and Langfuse datasets as an optional reusable source.
- [ ] Build Langfuse dataset and experiment adapters without duplicating Langfuse ownership locally.
- [ ] Bridge LangGraph evaluation-job nodes to the Langfuse Experiment Runner without reimplementing its case loop.
- [ ] Add deterministic evaluators for trace-observable facts such as tool selection, call ordering, structured validity, and exact boundaries.
- [ ] Add structured model evaluators using the common checkpoint result schema.
- [ ] Allow models from the available pool to be assigned to Target and Evaluation roles per run.
- [ ] Record the exact model, role, prompt/profile version, evaluator version, dataset or example identity, repetition policy, and budget for every result.
- [ ] Aggregate per-checkpoint, per-case, per-model, and whole-run results without allowing hard gates to disappear into averages.
- [ ] Publish traces, scores, metadata, and experiment relationships to Langfuse.
- [ ] Write a selective local snapshot containing the evaluated artifact revision, aggregate and aspect scores, failed or flagged cases, relevant message transcripts, available model/run metadata, and Langfuse IDs.
- [ ] Leave successful raw traces and the complete operational record in Langfuse.
- [ ] Add a headless command for the complete evaluation workflow.

### Execution policy

- Model assignments come from an available pool and are not fixed to permanent agent roles.
- Repetitions, cross-model comparisons, judge combinations, concurrency, and spend limits are explicit run settings whose defaults are chosen during implementation.
- Every model judgment uses structured output and checkpoint-specific anchors.
- LangGraph nodes do not require an LLM; each node uses the smallest mechanism appropriate to its operation.
- Agentic branches are bounded and observable; they may not create an open-ended evaluation loop.
- One LangGraph invocation owns one evaluation job and may coordinate multiple Langfuse experiments.
- Langfuse owns each experiment's item iteration, repetitions, concurrency, tracing, error isolation, scores, and comparison.
- Adapter metadata is collected on a best-effort basis; only normalized messages and model identity are required for a successful run.
- A completed comparable evaluation requires Langfuse. The Target Agent adapter may still be smoke-tested independently.
- Langfuse Cloud and self-hosted Langfuse use the same application contract.

### Acceptance criteria

- [ ] One command evaluates a Target Agent without a coding agent or the production BuildingAI application.
- [ ] The same evaluation pipeline can run the default ToolLoop adapter and a second minimal adapter.
- [ ] Every selected case produces attributable output or an explicit execution error.
- [ ] Tool checkpoints use actual tool-call and tool-result messages when the adapter exposes them; otherwise they are excluded with an explicit missing-evidence reason rather than inferred from the final answer.
- [ ] Every score has checkpoint evidence and evaluator identity.
- [ ] Every experiment and local evaluation snapshot identifies the exact artifact revision and content hash evaluated.
- [ ] Langfuse contains the complete comparable experiment record.
- [ ] The local snapshot contains enough selected evidence for the Operator to continue without copying the full run.
- [ ] No Agent Profile file is modified.

## Stage 3 — Operator Revision Workflow

### Goal

Let a neutral, bounded ReAct Operator edit the current Agent Profile under user direction, preserve every meaningful edit batch as a reversible revision, and measure revisions through the same evaluation backend.

### Pipeline

```text
Evaluation findings and selective snapshot
→ Inspect failures and suspected owners
→ Choose material profile-owned findings
→ Edit the current JSON and/or Markdown Agent Profile
→ Seal the successful edit batch as a complete immutable revision
→ Present the diff from its parent revision and intended effects
→ Run affected cases and unaffected regression checks
→ Compare the current revision with an earlier revision in Langfuse
→ Continue editing or revert to an earlier revision when needed
```

### Deliverables

- [ ] Implement the built-in Operator with LangChain `createAgent` and a bounded ReAct loop.
- [ ] Provide workspace-root-bounded list, read, write, patch, and diff tools backed by the workspace boundary rather than unrestricted process filesystem access.
- [ ] Provide history and revert tools backed by the artifact revision store.
- [ ] Provide separate tools for starting evaluation runs and inspecting canonical results and snapshots.
- [ ] Accept freestyle chat, optional example strings, and optional dataset references as working context.
- [ ] Let the Operator edit the current prompt text, tool selection and descriptions, model settings, and loop limits under user direction.
- [ ] Prevent the workflow from changing tool implementations or unrelated Target Agent source code.
- [ ] Keep general shell execution and arbitrary repository navigation outside the built-in Operator baseline.
- [ ] Seal each successful edit transaction, normally one intentional Operator edit batch, as a complete immutable revision linked to its parent.
- [ ] Produce a structured parent-to-current diff that names changed fields/files, targeted findings, and expected effects.
- [ ] Plan a focused retest containing affected cases and a small unaffected regression set.
- [ ] Link compared revision experiments in Langfuse.
- [ ] Compare hard gates and weighted checkpoint results by model and in aggregate.
- [ ] Preserve the current revision and comparison evidence locally as a selective snapshot.
- [ ] Revert by restoring the selected snapshot into the working files and appending a new revision with `restoredFrom`; do not rewrite history.
- [ ] Keep the revision model linear and omit candidate, acceptance, promotion, branch, merge, rebase, and delta-storage concepts.

### Stop policy

- Do not edit for failures attributed to runtime, tool implementation, data, or invalid cases unless the user expands the coding scope.
- Avoid sequences of cosmetic micro-edits unsupported by evaluation evidence.
- Stop when there is no material profile-owned finding or when the configured evaluation budget is exhausted.
- Surface model-dependent tradeoffs rather than hiding them in one aggregate score.

### Acceptance criteria

- [ ] Every material edit is linked to evidence it intends to address.
- [ ] Every evaluated revision uses the same backend and preserves model identities, revision ID, and content hash.
- [ ] New hard-gate failures and material regressions are visible.
- [ ] The user can inspect the complete JSON and Markdown diff between any two retained revisions.
- [ ] Reverting an older revision restores its files and records the restoration as a new immutable revision.

## Stage 4 — Minimal User Interface

### Goal

Host the Operator for nontechnical users in a low-navigation interface while leaving detailed evaluation operations in Langfuse.

### Deliverables

- [ ] Provide a chat-first onboarding flow for describing the use case.
- [ ] Accept optional example strings, files, or Langfuse dataset selection.
- [ ] Show the generated or edited JSON Agent Profile and Markdown prompt without requiring users to author code.
- [ ] Provide model-pool and evaluation-run controls with clear cost implications.
- [ ] Show progress, execution errors, hard gates, aspect scores, failed or flagged cases, and concise evidence.
- [ ] Show JSON and Markdown revision diffs and the focused comparison.
- [ ] Let the user browse revision history and revert to an earlier revision.
- [ ] Deep-link to the corresponding Langfuse experiments and traces.

### Non-goals

- Rebuilding Langfuse dataset management, evaluator administration, traces, annotations, dashboards, or score analytics.
- Requiring routine Langfuse navigation to complete the improvement workflow.
- Adding advanced visualization before ordinary chat, evidence, and diffs prove insufficient.

### Acceptance criteria

- [ ] A nontechnical user can move from freestyle description to an evaluated Agent Profile without writing code.
- [ ] The user can understand failures, compare revisions, and revert when needed without manually navigating Langfuse.
- [ ] Detailed evidence remains one link away in Langfuse.
- [ ] The UI invokes exactly the same backend contracts as the headless workflow.

## Stage 5 — Optional External Agent Interface

### Trigger

Begin only when external coding-agent usage demonstrates that the headless command or ordinary backend API is insufficient.

Pi, OpenCode, Codex, and other full coding agents are external operators at this boundary rather than alternate implementations required by the built-in Operator.

### Possible deliverables

- [ ] Expose project inspection, evaluation, comparison, and snapshot retrieval through a narrow MCP server or equivalent interface.
- [ ] Let external coding agents edit the same local JSON and Markdown artifacts rather than duplicating revision logic inside MCP.
- [ ] Distinguish read operations from cost-incurring evaluation runs.
- [ ] Return canonical structured results and Langfuse references.

### Acceptance criteria

- [ ] External agents and the built-in Operator use the same evaluation backend.
- [ ] MCP or another interface contains no duplicated evaluation or Agent Profile editing logic.
- [ ] UI, script, and external-agent runs remain comparable in Langfuse.

## Verification Strategy

For each stage, prove the smallest public boundary:

- [ ] Stage 1: parse representative JSON and Markdown artifacts and reproduce one skill-led review using canonical checkpoint results.
- [ ] Stage 2: run one compact Langfuse experiment through the reference Target Agent adapter and one minimal second adapter.
- [ ] Stage 3: demonstrate one evidence-backed edit, immutable revision, focused comparison, and history-preserving revert.
- [ ] Stage 4: complete one nontechnical chat-to-evaluation-to-decision workflow.
- [ ] Stage 5: prove one external-agent evaluation only if the interface is built.

Do not add broad test suites that freeze private module shape. Verify serialized contracts, observable agent behavior, Langfuse records, and visible user outcomes.

## Deferred Decisions

- [ ] Decide whether LangGraph persistence and resumability are required after the first bounded workflow is exercised.
- [ ] Decide whether a bounded fixer node belongs inside the Evaluator Agent or all profile editing remains with the Operator.
- [ ] Choose default model assignments, repetitions, judge combinations, concurrency, and spend limits from real run evidence.
- [ ] Decide how generated examples are reviewed and promoted into reusable Langfuse datasets.
- [ ] Choose Langfuse Cloud or self-hosting from access, cost, data, and operational requirements.
- [ ] Select the UI framework and hosting model.
- [ ] Decide whether MCP is necessary after the script and backend API are used.

## Immediate Sequence

- [ ] Approve the revised Stage 1 vocabulary and schema boundaries.
- [ ] Implement and validate Stage 1 in the skills and local artifacts.
- [ ] Specify the configurable LangGraph Evaluator Agent and the separate reusable evaluation contract.
- [ ] Implement the Langfuse-centric backend and Target Agent adapters.
- [ ] Review real experiment evidence before finalizing Stage 3 behavior.
- [ ] Keep UI and optional external-agent work deferred until the backend contract is proven.
