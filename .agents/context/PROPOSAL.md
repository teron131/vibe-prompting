# Prompting

## Proposal

Build a small application for editing, versioning, and selectively evaluating prompts without turning prompt work into a fixed evaluation ceremony.

The primary product artifact is prompt Markdown. PostgreSQL owns durable prompt identity and immutable revision history, while each Operator run receives one disposable `prompt.md` file and only the tools needed to read or replace exact passages in that file.

The product is an 80/20 workflow for improving real prompts, not a scientific benchmark laboratory, universal agent platform, model-distillation system, or replacement for Langfuse.

## Product Shape

Prompting has four related but separate surfaces:

- The Operator uses the OpenAI Agents SDK to follow a user's prompt-editing request with scoped file tools, optional Exa search, and an in-process evaluation tool.
- Prompt storage keeps durable prompt records and append-only Markdown revisions in PostgreSQL.
- The evaluator exposes one transport-neutral `evaluate(target, request)` function over opaque Targets and LLM judges, with optional Langfuse persistence.
- Fastify serves the temporary browser UI and HTTP API, while the optional MCP host mirrors only the external evaluation action.

The standalone Agent Test Bench remains separate. Its repo-local skills and prompt files test BuildingAI profiles; they are not the application's prompt database or Operator runtime.

## Operator Model

- The caller selects the Operator model from `.config.yaml`; there is no hard-coded product model.
- The Operator receives one isolated `prompt.md` initialized from the currently visible Markdown.
- `read_prompt` reads the whole file, and `edit_prompt` performs one exact, uniquely matching replacement.
- `evaluate_prompt` calls the transport-neutral evaluator directly and is used only when the user explicitly asks to test, validate, evaluate, or optimize behavior.
- `web_search_exa` is exposed through Exa's remote MCP server and is used only when the edit requires current or external information.
- Routine edits do not automatically trigger search or evaluation.
- The temporary workspace is deleted after the run; PostgreSQL, not the run directory, owns durable state.

## Prompt Versioning

- `prompts` owns stable prompt identity, title, and the current revision pointer.
- `prompt_revisions` stores immutable Markdown snapshots with their parent revision, source, change request, and creation time.
- Creating a prompt writes its initial user revision.
- After a successful Operator run, one transaction appends changed browser Markdown as a user revision before appending any changed Operator result as its child.
- If the Operator fails for an existing prompt, no revision is appended; a newly created prompt still survives because creation is a separate request completed before the Operator call.
- The expected revision ID prevents stale browser state from overwriting a newer edit.
- The browser keeps a newly created prompt recoverable after an Operator failure and does not claim that an Operator revision was written.

## Evaluation Model

- A Target is any opaque agent that exposes a configured model ID and an asynchronous input-output invocation.
- Each case keeps its criteria beside its raw input, and one structured-output call evaluates all of that case's criteria for each judge model.
- Boolean, categorical, numeric, text, and correction criteria remain invocation configuration rather than semantic subclasses.
- Multiple judges run independently, and every result retains its judge model, criterion, comment, and evidence.
- Fixed-history N+1 evaluation supplies one complete conversation and generates exactly one next response.
- Langfuse optionally stores experiments, traces, and scores when both credentials are configured; evaluation returns the same public result when both are absent.

## Ownership Boundaries

- `agents/operator/` owns the Operator composition and instructions.
- `tools/` owns tools that can be attached to an agent, including scoped prompt-file editing, direct evaluation, and the Exa adapter.
- `workspace/artifacts.ts` owns the disposable per-run prompt file.
- `workspace/versioning.ts` owns durable PostgreSQL prompt state and migrations.
- `agents/evaluator/api.ts` owns the transport-independent evaluation contract because both the Operator and application transports call it; putting it under `app/` would create an application-to-Operator dependency cycle.
- `app/` owns HTTP, browser, database setup, and MCP transport adapters rather than evaluation or prompt-editing rules.

## What Not to Build

- Native or unrestricted host filesystem access for the Operator.
- A mandatory edit-search-evaluate workflow.
- A backend dependency on repo-local skills, the standalone bench, or BuildingAI configuration.
- Another Langfuse dashboard, trace viewer, annotation system, or dataset editor.
- Mandatory statistical ceremony, large judge ensembles, fixed model roles, or universal evaluation criteria.
- An MCP layer between the Operator and evaluator when an in-process tool call is sufficient.
- A multi-turn simulator when a complete history plus one next response is sufficient.

## Current Direction

The 0.7.0 slice proves the smallest useful loop: create or load a prompt, preserve visible manual changes, let a selected model make localized edits through a disposable file, optionally search or evaluate when requested, and append the result to PostgreSQL revision history.

The current browser is intentionally a temporary proving surface. The next product work should follow observed editing needs rather than introduce more infrastructure before this workflow is used.
