# Vibe Prompting

## Proposal

Build a backend-first system that lets humans and AI agents create, version, search, refine, and selectively evaluate prompts through stable programmatic operations.

The TypeScript API, HTTP/OpenAPI server, MCP server, built-in agent, and browser are adapters over the same Prompt System and Evaluation System. The browser is a useful reference client, but no core workflow or business rule belongs only to the UI.

The product is an 80/20 prompt-engineering runtime for practical iteration, not a scientific benchmark laboratory, universal artifact platform, model-distillation system, or replacement for Langfuse.

## Domain Model

- A Prompt owns stable identity, a human-readable title, metadata, and a pointer to its current revision.
- A Prompt Revision is an immutable full-content snapshot with a parent revision, author (`human` or `ai`), change request, and creation time.
- A Prompt Passage is a derived section of one revision used for sentence- and paragraph-level search; it is not separately authoritative content.
- A Target is any opaque input-output runtime with a configured model identity.
- An Evaluation Request contains cases, criteria, judges, and target configuration without requiring a Prompt.
- An Evaluation Run records one execution and its outputs, per-criterion scores, judge attribution, evidence, status, and configuration.
- An Evaluation Run may reference an exact Prompt Revision when the evaluated Target was constructed from that revision, but Evaluation does not belong to Prompt and a Prompt does not require Evaluation.

Prompt and Evaluation records remain separate. Their optional relationship is expressed by stable prompt and revision identifiers on a run rather than by embedding evaluation state inside a Prompt.

## Prompt System

The Prompt System is the single owner of durable prompt behavior:

- Create, list, read, update, and search prompts.
- Read exact revisions and revision metadata.
- Append human and AI revisions with optimistic concurrency.
- Navigate immutable history with undo and redo by moving the current-revision pointer.
- Search current revisions at prompt and passage granularity.

PostgreSQL stores complete Markdown snapshots because prompts are small and exact recovery is more valuable than storage-level diff complexity. Line-, word-, character-, and whitespace-level diffs are derived when requested and are never the source of truth.

Prompt search belongs to the Prompt System, while external embedding transport remains a client dependency. Search indexes derived passages from current revisions and can later change ranking or providers without changing prompt storage contracts.

## Evaluation System

The Evaluation System owns one transport-neutral evaluation capability shared by every adapter:

- Evaluate opaque Targets against case-local criteria with one or more judges.
- Support Boolean, categorical, numeric, text, and correction criteria as configuration rather than hard-coded evaluator classes in the product workflow.
- Persist runs, cases, outputs, scores, evidence, status, and exact configuration when durable tracking is requested.
- Resolve or receive an exact Prompt Revision snapshot for prompt-linked runs without making Prompt System depend on Evaluation.
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
- Use external search only when current or outside information is required.

A disposable `prompt.md` workspace may remain an internal editing technique, but it is not another prompt store and must not create a second evaluation implementation. Any successful edit is committed through Prompt System, and every evaluation uses Evaluation System.

## Public Surfaces

- The TypeScript API is the direct in-process contract for application composition and external library use.
- Fastify exposes headless HTTP and OpenAPI operations over the same systems.
- MCP exposes prompt discovery, revision operations, search, editing, evaluation, and run inspection for external agents.
- The built-in agent composes the same operations into natural-language workflows.
- The Next.js browser provides a simple non-technical interface over those operations without becoming their owner.

Adapters may translate schemas, authentication, streaming, and presentation. They must not implement separate prompt versioning, evaluation semantics, or persistence rules.

## Ownership Boundaries

- `prompt-system/` owns prompt identity, immutable revisions, history navigation, derived search, and its persistence rules.
- `evaluation/` owns the evaluator contract, judge orchestration, persisted runs, reports, and optional Langfuse integration.
- `agent/` owns natural-language orchestration and thin tool adapters over public system operations.
- `clients/` owns external provider transports such as language models, embeddings, Exa, and Langfuse clients.
- `app/` owns Fastify, MCP, database setup, and application composition rather than domain rules.
- `frontend/` owns browser interaction and presentation rather than backend behavior.
- The standalone Agent Test Bench owns BuildingAI matrices, repeated experiments, profile fixtures, and its own inspection workflow; it is not application storage or runtime ownership.

## What Not to Build

- A UI-first backend whose useful workflows only exist through browser routes.
- A generic Artifact abstraction before the product has a real non-prompt object with different behavior.
- A mandatory edit-search-evaluate ceremony.
- Separate evaluation implementations for temporary workspaces, persisted prompts, HTTP, MCP, or the browser.
- Transport-based domain actors such as `browser` and `operator`; authors are `human` or `ai`, while transport is separate metadata when needed.
- Storage-level text diffs or many copied prompt records masquerading as versions.
- A hard dependency on Langfuse or a duplicate Langfuse dashboard.
- Native or unrestricted host filesystem access for an agent.
- A backend dependency on repo-local skills, the standalone bench, or BuildingAI configuration.
- A multi-turn simulator when a complete history plus one generated next response is sufficient.

## Current Alignment

The current backend already has the main foundations: a `PromptSystem` with immutable full revisions, human/AI authors, optimistic concurrency, undo/redo, current-revision passage search, a transport-neutral `evaluate(target, request)` function, persisted prompt-linked evaluation runs, thin external clients, and independently runnable Fastify, MCP, and browser adapters.

The remaining structural misalignments are concrete:

- `streamPromptEdit` begins from raw Markdown in a disposable workspace; the durable workflow should address a Prompt ID and expected revision, then commit through Prompt System before any linked evaluation.
- MCP currently mirrors only stateless evaluation; it should expose the useful Prompt System and Evaluation System operations needed by an external coding agent.
- Application-facing stateless and persisted evaluation entry points should share one Evaluation System boundary and result meaning rather than evolve as parallel products.

## Current Direction

Complete one result-driven baseline: an external or built-in agent finds a saved prompt, reads its exact revision, makes a requested localized improvement, saves a new revision, optionally evaluates that revision, and returns a durable result that can be inspected through MCP, HTTP, or the browser.

After that loop works end to end, improve presets, trends, Langfuse export, richer search, and presentation only when observed usage earns them.
