# Vibe Prompting

## Proposal

Build a backend-first system that lets humans and AI agents create, version, search, refine, run, and selectively evaluate prompts through stable programmatic operations.

The TypeScript API, HTTP/OpenAPI server, MCP server, built-in agent, and browser are adapters over the same Prompt System, Target System, and Evaluation System. The browser is a useful reference client, but no core workflow or business rule belongs only to the UI.

The product is an 80/20 prompt-engineering runtime for practical iteration, not a scientific benchmark laboratory, universal artifact platform, model-distillation system, or replacement for Langfuse.

## Domain Model

- A Prompt owns stable identity, a human-readable title, metadata, and a pointer to its current revision.
- A Prompt Revision is an immutable full-content snapshot with a parent revision, author (`human` or `ai`), change request, and creation time.
- A Prompt Passage is a derived section of one revision used for sentence- and paragraph-level search; it is not separately authoritative content.
- A Target is any opaque input-output runtime with a configured model identity and an `invoke` operation.
- A Target Profile is revisioned runtime configuration and supplemental instructions associated with a Prompt without copying its content.
- A Pinned Target combines one Target Profile revision, one exact Prompt Revision, and one configured model into a repeatable runtime for an application run.
- An Evaluation Request contains cases, criteria, judges, and a Target without requiring a Prompt or Target Profile.
- An Evaluation Run records one execution and its outputs, per-criterion scores, judge attribution, evidence, status, and configuration.
- An Evaluation Run may reference an exact Prompt Revision when the evaluated Target was constructed from that revision, but Evaluation does not belong to Prompt and a Prompt does not require Evaluation.

Prompt, Target Profile, and Evaluation records remain separate. Their relationships are expressed by stable identifiers and pinned revision identifiers rather than by embedding runtime or evaluation state inside a Prompt.

## Prompt System

The Prompt System is the single owner of durable prompt behavior:

- Create, list, read, update, and search prompts.
- Read exact revisions and revision metadata.
- Append human and AI revisions with optimistic concurrency.
- Navigate immutable history with undo and redo by moving the current-revision pointer.
- Search current revisions at prompt and passage granularity.

PostgreSQL stores complete Markdown snapshots because prompts are small and exact recovery is more valuable than storage-level diff complexity. Line-, word-, character-, and whitespace-level diffs are derived when requested and are never the source of truth.

Prompt search belongs to the Prompt System, while external embedding transport remains a client dependency. Search indexes derived passages from current revisions and can later change ranking or providers without changing prompt storage contracts.

## Target System

The Target System owns construction of runtimes that can execute prompt behavior without owning prompt editing or evaluation:

- Keep the public Target contract small: a configured model identity and an opaque input-output invocation.
- Accept caller-supplied Targets directly for transport-neutral evaluation.
- Store Target Profiles and their revisions separately from Prompt content so runtime instructions, tools, and limits can change without duplicating prompts.
- Construct a Pinned Target from an exact Prompt Revision, one Target Profile revision, and one configured model, then record the effective-instructions hash and resolved configuration on a durable run.
- Provide a vanilla Vercel AI SDK runtime for the application fallback while keeping AI SDK and LangChain adapters available for externally constructed agents.
- Reuse shared model, search, and spend-limit clients rather than implementing provider behavior inside Target System.

Target System does not own judges, scores, prompt revisions, or the built-in editing agent. A richer external runtime may remain entirely opaque as long as it satisfies the Target input-output contract.

## Evaluation System

The Evaluation System owns one transport-neutral evaluation capability shared by every adapter:

- Evaluate opaque Targets against case-local criteria with one or more judges.
- Support Boolean, categorical, numeric, text, and correction criteria as configuration rather than hard-coded evaluator classes in the product workflow.
- Persist runs, cases, outputs, scores, evidence, status, and exact configuration when durable tracking is requested.
- Accept any caller-supplied Target through the public `evaluate(target, request)` operation.
- Resolve a Pinned Target through Prompt System and Target System for prompt-linked durable runs without either system depending on Evaluation.
- Return the same evaluation meaning whether invoked from MCP, HTTP, the built-in agent, or the browser.

Common checks such as language, intent, grounding, truthfulness, and response quality may be offered as editable presets. They are not mandatory global gates.

Langfuse remains an optional observability and export integration. Evaluation works standalone without Langfuse, and enabling Langfuse must not change the local result contract.

## Agent Workflow

The built-in agent is one client of the backend systems rather than the product owner. It should expose a small coding-agent-style workflow through functions:

- Find a prompt through list or passage search.
- Read the current content and exact revision before changing it.
- Apply a localized edit and save it as an AI revision.
- Evaluate only when the user requests evaluation or supplies acceptance criteria.
- When the user asks for both refinement and evaluation, use separate edit and evaluation operations in sequence, passing the saved revision ID explicitly.
- Treat the built-in OpenAI Agents SDK runtime as the editing and orchestration client, not as the Target runtime being evaluated.
- Use external search only when current or outside information is required.

A disposable `prompt.md` workspace may remain an internal editing technique, but it is not another prompt store and must not create a second evaluation implementation. Any successful edit is committed through Prompt System, and every evaluation uses Evaluation System.

## Public Surfaces

- The TypeScript API is the direct in-process contract for application composition and external library use.
- Fastify exposes headless HTTP and OpenAPI operations over the same systems.
- MCP is the external-agent adapter and should expose prompt discovery, revision operations, search, editing, evaluation, and run inspection without inventing separate semantics.
- The built-in agent composes the same operations into natural-language workflows.
- The Next.js browser provides a simple non-technical interface over those operations without becoming their owner.

Adapters may translate schemas, authentication, streaming, and presentation. They must not implement separate prompt versioning, evaluation semantics, or persistence rules.

## Ownership Boundaries

- `prompt-system/` owns prompt identity, immutable revisions, history navigation, derived search, and its persistence rules.
- `target/` owns the small Target contract, revisioned Target Profiles, pinned runtime construction, and AI SDK or LangChain interoperability adapters.
- `evaluation/` owns the evaluator contract, judge orchestration, persisted runs, reports, and optional Langfuse integration.
- `agent/` owns natural-language orchestration and thin tool adapters over public system operations.
- `conversations/` owns durable general-chat history and detached assistant-run reconciliation rather than prompt or evaluation records.
- `clients/` owns external provider transports such as language models, embeddings, Exa, and Langfuse clients.
- `config/` owns validated runtime configuration and shared optional spend limits, while `settings/` owns user-editable persisted application settings.
- `app/` owns Fastify, MCP, database setup, and application composition rather than domain rules.
- `frontend/` owns browser interaction and presentation rather than backend behavior.
- The standalone Agent Test Bench owns BuildingAI matrices, repeated experiments, profile fixtures, and its own inspection workflow; it is not application storage or runtime ownership.

## What Not to Build

- A UI-first backend whose useful workflows only exist through browser routes.
- A generic Artifact abstraction before the product has a real non-prompt object with different behavior.
- A mandatory edit-search-evaluate ceremony.
- A combined revise-and-evaluate domain operation that hides the saved revision between two independent actions.
- Separate evaluation implementations for temporary workspaces, persisted prompts, HTTP, MCP, or the browser.
- A Target runtime that owns judge orchestration or an evaluator that knows how a supplied opaque Target works internally.
- Transport-based domain actors such as `browser` and `operator`; authors are `human` or `ai`, while transport is separate metadata when needed.
- Storage-level text diffs or many copied prompt records masquerading as versions.
- A hard dependency on Langfuse or a duplicate Langfuse dashboard.
- Native or unrestricted host filesystem access for an agent.
- A backend dependency on repo-local skills, the standalone bench, or BuildingAI configuration.
- A multi-turn simulator when a complete history plus one generated next response is sufficient.

## Current Alignment

The implemented baseline now has three distinct backend systems. `PromptSystem` owns immutable full revisions, human/AI authors, optimistic concurrency, undo/redo, deletion, and current-revision passage search. `TargetSystem` owns revisioned prompt-associated profiles and constructs pinned vanilla AI SDK targets while public AI SDK and LangChain adapters support externally supplied runtimes. Evaluation exposes the transport-neutral `evaluate(target, request)` boundary and a durable prompt-linked `EvaluationRuns` service with exact prompt, profile, model, configuration, output, score, evidence, and judge attribution.

The built-in agent uses separate prompt patching and evaluation tools, passes revision IDs explicitly, and supports in-run steering without blending target execution into editing orchestration. The browser now exercises the baseline through searchable prompt workspaces, a resizable prompt explorer/editor, revision history and diffs, evaluation reports, and general chat, but those surfaces remain clients of backend owners.

The remaining gaps are narrower:

- MCP currently exposes only stateless evaluation, and Fastify exposes a smaller subset than the browser; both should reach useful Prompt, Target, and durable Evaluation operations through the same application services.
- Persisted application runs currently construct the built-in prompt-linked AI SDK Target; durable execution of a caller-supplied opaque Target needs an explicit remote or callback boundary before it is warranted.
- Target Profile management and direct target testing are backend capabilities without a complete non-technical browser workflow.
- Langfuse export, broader presets, aggregate evaluation statistics, and richer trends remain optional follow-up work rather than prerequisites for the core loop.

## Current Direction

Stabilize the result-driven loop as a portable backend contract: find and read an exact Prompt Revision, apply and save one localized change, construct or receive a Target, optionally evaluate it, and inspect the durable result from any supported adapter.

Prioritize MCP and HTTP parity plus a small Target Profile and test workflow before deeper analytics. Add presets, trends, Langfuse export, richer search, and presentation only when observed usage earns them.
