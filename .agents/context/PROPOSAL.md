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
- An Evaluation Criteria Profile is a reusable ordered set of typed criteria; each Evaluation Run still stores its exact criteria snapshot so later profile edits cannot change historical meaning.
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

Prompt System owns projection of current revisions into searchable passages. The shared search capability owns target-agnostic keyword matching, semantic fallback, ranking thresholds, and the derived embedding cache, while external embedding transport remains a client dependency. Prompt search can therefore change ranking or providers without changing prompt storage contracts.

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
- Manage reusable ordered criteria profiles while keeping exact criteria snapshots on every durable run.
- Persist runs, cases, outputs, scores, evidence, status, and exact configuration when durable tracking is requested.
- Expand batch configuration into an exact manifest before execution, then start each run asynchronously and expose progress through durable run status.
- Search paginated case results by exact identifier, hybrid text retrieval, and shared filters, then compute compatible analytics over the same filtered result set.
- Accept any caller-supplied Target through the public `evaluate(target, request)` operation.
- Resolve a Pinned Target through Prompt System and Target System for prompt-linked durable runs without either system depending on Evaluation.
- Return the same evaluation meaning whether invoked from MCP, HTTP, the built-in agent, or the browser.

Common checks such as language, intent, grounding, truthfulness, and response quality may be offered as editable presets. They are not mandatory global gates.

Langfuse remains an optional observability and export integration. Evaluation works standalone without Langfuse, and enabling Langfuse must not change the local result contract.

## Agent Workflow

The built-in agent is one client of the backend systems rather than the product owner. It should expose a small coding-agent-style workflow through functions:

- Find a prompt through list or passage search.
- Read the current content and exact revision before changing it.
- Load that revision into an isolated in-memory workspace, apply structured line-addressed edits, and save the completed content as one AI revision.
- Evaluate only when the user requests evaluation or supplies acceptance criteria.
- When the user asks for both refinement and evaluation, use separate edit and evaluation operations in sequence, passing the saved revision ID explicitly.
- Preview or start durable evaluation batches through the same server-owned expansion used by human-triggered runs.
- Translate simple result questions into allowlisted structured operations through the configured helper model at low reasoning effort; never give that model arbitrary SQL access.
- Treat the built-in OpenAI Agents SDK runtime as the editing and orchestration client, not as the Target runtime being evaluated.
- Use external search only when current or outside information is required.

The workspace is one in-memory Markdown string loaded from Prompt System rather than a real or virtual filesystem. It is not another prompt store and must not create a second evaluation implementation. Any successful edit is committed through Prompt System, and every evaluation uses Evaluation System.

## Agent Editing Contract

The editing agent receives one narrowly scoped document capability rather than general filesystem tools:

- `read_prompt` returns the complete current Markdown with each physical line represented as `LINE#HASH:content`.
- `edit_prompt` accepts structured `replace_range`, `insert_before`, `insert_after`, and `append` operations that reference hashes copied from the latest read.
- The backend validates every referenced line against the current in-memory content and applies the complete batch atomically.
- Stale, overlapping, ambiguous, malformed, and no-op edits fail clearly and require the agent to read again when necessary.
- Successful workspace content is persisted once through Prompt System with the expected revision identifier and becomes a new immutable AI-authored revision.

Hashline is only an addressing technique in this product. It does not justify a patch language, filesystem facade, temporary file, CLI, MCP editing server, daemon, block parser, merge engine, relocation heuristic, or automatic repair of malformed agent input.

## Public Surfaces

- The TypeScript API is the direct in-process contract for application composition and external library use.
- Fastify exposes headless HTTP and OpenAPI operations for prompt editing, configured models, durable evaluation runs and batches, criteria profiles, paginated results, analytics, structured queries, and result exploration over the same systems.
- MCP is an application adapter and may expose Prompt System, Target System, and Evaluation System operations without inventing separate semantics or hosting an independent editing implementation.
- The built-in agent composes the same operations into natural-language workflows.
- The Next.js browser provides a simple non-technical interface over those operations without becoming their owner.

Adapters may translate schemas, authentication, streaming, and presentation. They must not implement separate prompt versioning, evaluation semantics, or persistence rules.

## Ownership Boundaries

- `prompt-system/` owns prompt identity, immutable revisions, history navigation, derived search, and its persistence rules.
- `target/` owns the small Target contract, revisioned Target Profiles, pinned runtime construction, and AI SDK or LangChain interoperability adapters.
- `evaluation/api.ts` and `evaluation/engine/` own the transport-neutral evaluator contract, typed criteria, judge orchestration, and optional Langfuse tracing.
- `evaluation/runs/` owns durable run schemas, target preparation and detached lifecycle orchestration, PostgreSQL state transitions, report projection, and compatible revision trends.
- `evaluation/results/` owns result filters, per-domain search projection, paginated PostgreSQL queries, aggregate analytics, and the helper-model translation into allowlisted read operations.
- `evaluation/criteria-profiles.ts` owns reusable ordered criteria profiles without becoming the source of truth for historical run criteria.
- `agent/` owns natural-language orchestration and thin tool adapters over public system operations.
- `conversations/` owns durable general-chat history and detached assistant-run reconciliation rather than prompt or evaluation records.
- `search.ts` owns target-agnostic hybrid matching, semantic ranking, thresholds, and derived embedding-cache lifecycle; each domain owner projects its own searchable documents.
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
- A standalone CLI, MCP server, daemon, or filesystem emulation layer for editing one database-backed prompt.
- Raw unified, V4A, or bespoke patch syntax when structured edit operations can express the same change directly.
- A backend dependency on repo-local skills, the standalone bench, or BuildingAI configuration.
- A multi-turn simulator when a complete history plus one generated next response is sufficient.

## Current Alignment

The implemented baseline has distinct Prompt, Target, and Evaluation systems. `PromptSystem` owns immutable full revisions, human/AI authors, optimistic concurrency, undo/redo, deletion, and current-revision passage projection. `TargetSystem` owns revisioned prompt-associated profiles and constructs pinned vanilla AI SDK targets while public AI SDK and LangChain adapters support externally supplied runtimes. The shared hybrid search capability applies one keyword and semantic policy to prompt passages, chats, and evaluation cases while each owner controls its document projection.

Evaluation exposes the transport-neutral `evaluate(target, request)` boundary plus durable prompt-linked asynchronous runs and batches. A batch pins every job and persists all run records atomically before detached execution begins, while completion can only commit outputs and scores for a run that remains active. The backend stores exact prompt, target profile, model, configuration, output, score, evidence, judge attribution, status, synthetic provenance, and criteria snapshots. Criteria profiles are reusable CRUD resources, while result browsing, typed aggregates, chronological trends, and allowlisted structured exploration all read the same persisted facts and filters.

The built-in agent uses separate structured prompt editing, evaluation execution, evaluation search, and evaluation analytics tools, passes revision IDs explicitly, and can preview or start the same durable batches as a human client. Prompt editing operates on one isolated in-memory string with hash-addressed structured operations and persists only through Prompt System. The configured helper model only translates plain-language questions into validated read operations at low reasoning effort. The browser now has separate run setup, result exploration, aggregate analytics, criteria management, and LLM-assisted exploration surfaces, but those surfaces remain clients of backend owners.

The remaining gaps are narrower:

- MCP currently exposes only stateless evaluation and should reach useful Prompt, Target, durable Evaluation, result, and criteria-profile operations through the same application services.
- Asynchronous runs are owned by the current server process. Startup reconciliation marks abandoned running work as interrupted, but durable resumption or a separate worker queue is not yet implemented.
- Persisted application runs currently construct the built-in prompt-linked AI SDK Target; durable execution of a caller-supplied opaque Target needs an explicit remote or callback boundary before it is warranted.
- Target Profile management and direct target testing remain backend capabilities without a complete non-technical workflow.
- Langfuse export and broader editable presets remain optional follow-up work rather than prerequisites for the core loop.

## Current Direction

Stabilize the result-driven loop as a portable backend contract: find and read an exact Prompt Revision, apply one atomic batch of hash-addressed structured edits, save one immutable revision, construct or receive a Target, preview and optionally start an evaluation batch, and inspect durable results and aggregates from any supported adapter.

Prioritize durable worker ownership, MCP parity, and a small Target Profile and direct-test workflow. Add broader presets and Langfuse export only when observed usage earns them; do not duplicate the existing result browser, hybrid search, or aggregate analytics in another subsystem.
