# Vibe Prompting

## Proposal

Build a backend-first system that lets humans and AI agents create, version, search, refine, run, and selectively evaluate prompts through stable programmatic operations.

The TypeScript API, HTTP/OpenAPI server, MCP server, built-in agent, and browser are adapters over the same Prompt System, Target System, and Evaluation System. The browser is a useful reference client, but no core workflow or business rule belongs only to the UI.

The product is an 80/20 prompt-engineering runtime for practical iteration, not a scientific benchmark laboratory, universal artifact platform, model-distillation system, or replacement for Langfuse.

## Domain Model

- A Prompt owns stable identity, a human-readable title, metadata, a pointer to its active revision, and an independent editor history cursor for undo and redo.
- A Prompt Revision is an immutable full-content snapshot with a parent revision, author (`human` or `ai`), change request, and creation time.
- A Prompt Passage is a derived section of one revision used for sentence- and paragraph-level search; it is not separately authoritative content.
- A Target is any opaque input-output runtime with a configured model identity and an `invoke` operation.
- A Target Profile is revisioned runtime configuration and supplemental instructions associated with a Prompt without copying its content.
- A Pinned Target combines one Target Profile revision, one exact Prompt Revision, and one configured model into a repeatable runtime for an application run.
- A Target Run is a durable multi-turn trace over one Pinned Target, separate from general chat history and available to human and AI clients.
- An Evaluation Request contains cases, criteria, judges, and a Target without requiring a Prompt or Target Profile.
- An Evaluation Criteria Profile is a reusable ordered set of typed criteria; each Evaluation Run still stores its exact criteria snapshot so later profile edits cannot change historical meaning.
- An Evaluation Run records one execution and its outputs, per-criterion scores, judge attribution, evidence, status, and configuration.
- An Evaluation Run may reference an exact Prompt Revision when the evaluated Target was constructed from that revision, but Evaluation does not belong to Prompt and a Prompt does not require Evaluation.

Prompt, Target Profile, and Evaluation records remain separate. Their relationships are expressed by stable identifiers and pinned revision identifiers rather than by embedding runtime or evaluation state inside a Prompt.

## Workspace and Access Model

The product currently has one implicit shared workspace rather than separate organizations or teams.

- A User is a Google-backed application identity with an email, display name, membership status, and application-owned identifier.
- A pending User has completed Google verification but cannot enter the workspace until the shared invitation code activates the membership.
- An active User may create and use workspace resources until the membership or application session is revoked.
- An Application Session is an opaque revocable browser credential whose hash and expiry are stored in PostgreSQL; it is distinct from Google identity tokens and OAuth state.
- A Chat and its messages belong to one User and are never shared through workspace reads.
- Prompts, Prompt Revisions, Target Profiles, Target Runs, Evaluation Criteria Profiles, Evaluation Runs, and Settings are shared workspace resources with user attribution on writes.

Google OpenID Connect owns identity verification, while the application owns membership, invitations, sessions, authorization, and data access.
Shared projections may expose a contributor's display name when useful, but must not expose member email addresses or Google subjects to other users.
Browser routes derive the actor or viewer from the application session rather than accepting a user identifier from the browser.
PostgreSQL transactions own private-chat scope, optimistic revision conflicts, durable workflow state, cancellation, queue ordering, and invitation throttling.

## Prompt System

The Prompt System is the single owner of durable prompt behavior:

- Create, list, read, update, and search prompts.
- Read exact revisions and revision metadata.
- Append human and AI revisions with optimistic concurrency.
- Navigate immutable history with undo and redo by moving the editor history cursor without changing the active revision.
- Select the active revision used by product-wide prompt consumers.
- Search active revisions at prompt and passage granularity.

PostgreSQL stores complete Markdown snapshots because prompts are small and exact recovery is more valuable than storage-level diff complexity. Line-, word-, character-, and whitespace-level diffs are derived when requested and are never the source of truth.

Prompt System owns projection of active revisions into searchable passages. The shared search capability owns target-agnostic keyword matching, semantic fallback, ranking thresholds, and the derived embedding cache, while external embedding transport remains a client dependency. Prompt search can therefore change ranking or providers without changing prompt storage contracts.

## Target System

The Target System owns construction of runtimes that can execute prompt behavior without owning prompt editing or evaluation:

- Keep the public Target contract small: a configured model identity and an opaque input-output invocation.
- Accept caller-supplied Targets directly for transport-neutral evaluation.
- Store Target Profiles and their revisions separately from Prompt content so runtime instructions, tools, and limits can change without duplicating prompts.
- Construct a Pinned Target from an exact Prompt Revision, one Target Profile revision, and one configured model, then record the effective-instructions hash and resolved configuration on a durable run.
- Provide a vanilla Vercel AI SDK runtime for the application fallback while keeping AI SDK and LangChain adapters available for externally constructed agents.
- Persist Target Runs and their completed turn history so a client can continue the same pinned runtime or inspect the exact trace later.
- Reuse generic agent integrations and lower-level search and spend-limit clients rather than implementing provider behavior inside Target System.

Target System does not own judges, scores, prompt revisions, or the built-in editing agent. A richer external runtime may remain entirely opaque as long as it satisfies the Target input-output contract.

## Evaluation System

The Evaluation System owns one transport-neutral evaluation capability shared by every adapter:

- Evaluate opaque Targets against case-local criteria with one or more judges.
- Evaluate a selected completed Target Run turn through the same judge pipeline without invoking the Target again.
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
- Start, continue, and inspect durable Target Runs through the same Target Run service used by the browser.
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
- Fastify exposes trusted loopback HTTP and OpenAPI operations for prompt editing, configured models, durable Target Runs, durable evaluation runs and batches, criteria profiles, paginated results, analytics, structured queries, and result exploration over the same systems.
- MCP is a trusted loopback application adapter and may expose Prompt System, Target System, and Evaluation System operations without inventing separate semantics or hosting an independent editing implementation.
- The built-in agent composes the same operations into natural-language workflows.
- The Next.js browser authenticates through Google and application sessions, then provides a simple non-technical interface over those operations without becoming their owner.

Adapters may translate schemas, authentication, streaming, and presentation. They must not implement separate prompt versioning, evaluation semantics, or persistence rules.

## Ownership Boundaries

- `prompt-system/` owns prompt identity, immutable revisions, history navigation, derived search, and its persistence rules.
- `target/` owns the small Target contract, revisioned Target Profiles, pinned runtime construction, and AI SDK or LangChain interoperability adapters.
- `target/runs/` owns durable multi-turn Target Run lifecycle, pinned history replay, event snapshots, and PostgreSQL trace persistence.
- `evaluation/api.ts` and `evaluation/engine/` own the transport-neutral evaluator contract, typed criteria, judge orchestration, and optional Langfuse tracing.
- `evaluation/runs/` owns durable run schemas, target preparation and detached lifecycle orchestration, PostgreSQL state transitions, report projection, and compatible revision trends.
- `evaluation/results/` owns result filters, per-domain search projection, paginated PostgreSQL queries, aggregate analytics, and the helper-model translation into allowlisted read operations.
- `evaluation/criteria-profiles.ts` owns reusable ordered criteria profiles without becoming the source of truth for historical run criteria.
- `agents/tools/` owns framework-neutral agent tool definitions over direct clients and public system operations, `agents/ai-sdk/` and `agents/openai-agents/` own agent runtime integration, and each runtime usage owns its tool adaptation.
- `auth/` owns Google-backed identity upsert, pending and active membership, invitation throttling, and opaque application-session lifecycle.
- `conversations/` owns private durable general-chat history, owner scoping, and detached assistant-run reconciliation rather than prompt or evaluation records.
- `database/` owns the PostgreSQL client, ordered migrations, migration locking, and database setup rather than domain queries or authorization rules.
- `search.ts` owns target-agnostic hybrid matching, semantic ranking, thresholds, and derived embedding-cache lifecycle; each domain owner projects its own searchable documents.
- `clients/` owns direct model and service clients plus shared provider primitives that do not construct agent runtimes, including LangChain chat models, embeddings, Exa Search API access, Exa MCP connection data, Langfuse, model identity, pricing, and spend accounting.
- `config/` owns validated runtime configuration and shared optional spend limits, while `settings/` owns shared user-editable persisted application settings with revision conflicts and contributor attribution.
- `app/` owns Fastify, MCP, database setup, and application composition rather than domain rules.
- `frontend/auth/`, `frontend/server/`, and `frontend/proxy.ts` own browser-session resolution, route protection, request validation, and safe transport errors, while the rest of `frontend/` owns browser interaction and presentation rather than backend behavior.
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

The implemented baseline has distinct Prompt, Target, and Evaluation systems. `PromptSystem` owns immutable full revisions, human/AI authors, optimistic concurrency, an independent editor history cursor, explicit active-revision selection, deletion, and active-revision passage projection. `TargetSystem` owns revisioned prompt-associated profiles, constructs pinned vanilla AI SDK targets, and persists separate multi-turn Target Runs that both human and AI clients can start, continue, and inspect. Public AI SDK and LangChain adapters support externally supplied runtimes. The shared hybrid search capability applies one keyword and semantic policy to prompt passages, chats, and evaluation cases while each owner controls its document projection.

Evaluation exposes the transport-neutral `evaluate(target, request)` boundary plus durable prompt-linked asynchronous runs and batches. It can also score a completed Target Run turn through the same judge graph while skipping target invocation and retaining trace provenance. A batch pins every job and persists all run records atomically before detached execution begins, while completion can only commit outputs and scores for a run that remains active. The backend stores exact prompt, target profile, model, configuration, output, score, evidence, judge attribution, status, synthetic provenance, criteria snapshots, and optional Target Run references. Criteria profiles are reusable CRUD resources, while result browsing, typed aggregates, chronological trends, and allowlisted structured exploration all read the same persisted facts and filters.

Google-backed Users, invitation-gated membership, and opaque revocable sessions now protect the browser workspace. Chats are owner-scoped in PostgreSQL, while prompts, revisions, profiles, settings, Target Runs, and Evaluation Runs remain shared and retain contributor attribution. Shared projections expose contributor names where useful without exposing member email addresses. The trusted Fastify adapter is forced to loopback and validates supplied actor or viewer identifiers as active members, while browser routes always derive identity from the session.

Evaluation queue draining is single-flighted, provider capacity hands off slots without exceeding its configured limit, and PostgreSQL guards cancellation and terminal workflow transitions against late workers. Invitation failures are transactionally throttled, migration execution is serialized with an advisory lock, and the database pool supports concurrent request and workflow activity.

The built-in agent uses separate structured prompt editing, Target Run, evaluation execution, evaluation search, and evaluation analytics tools, passes revision IDs explicitly, and can operate the same durable Target Runs and evaluation batches as a human client. Prompt editing operates on one isolated in-memory string with hash-addressed structured operations and persists only through Prompt System. The configured helper model only translates plain-language questions into validated read operations at low reasoning effort. The browser reuses the general conversation presentation in an explicit Test Target mode whose traces are not stored in general chat history, and it can launch judge-only evaluation from a selected completed turn. The other run setup, result exploration, aggregate analytics, criteria management, and LLM-assisted exploration surfaces remain clients of backend owners.

The remaining gaps are narrower:

- MCP currently exposes only stateless evaluation and should reach useful Prompt, Target, durable Evaluation, result, and criteria-profile operations through the same application services.
- Asynchronous execution is still owned by the current server process. Durable queue and terminal state are stored in PostgreSQL and startup reconciliation marks abandoned running work as interrupted, but durable resumption or a separate worker process is not yet implemented.
- Persisted application runs currently construct the built-in prompt-linked AI SDK Target; durable execution of a caller-supplied opaque Target needs an explicit remote or callback boundary before it is warranted.
- Target Profile revision management remains backend-only even though the active profile and pinned revision are visible in the direct-test workflow.
- Membership uses one shared invitation code, and administrative member listing, revocation, or code rotation has no browser workflow yet.
- Migration 021 intentionally replaces disposable pre-multi-user artifacts before adding mandatory ownership, so a meaningful existing database would require a separate data migration instead of the current replacement rollout.
- Langfuse export and broader editable presets remain optional follow-up work rather than prerequisites for the core loop.

## Current Direction

Treat authentication, membership, private chats, shared workspace attribution, and PostgreSQL workflow coordination as the stable application backbone rather than the next feature area.

Continue the result-driven product loop: find and read an exact Prompt Revision, apply one atomic batch of hash-addressed structured edits, save one immutable revision, construct or receive a Target, preview and optionally start an evaluation batch, and inspect durable results and aggregates from any supported adapter.

Prioritize meaningful agent workflow, prompt iteration, and evaluation improvements. Revisit the multi-user backbone only when a concrete feature exposes a missing authorization or ownership rule, and add durable worker ownership, MCP parity, broader presets, or Langfuse export only when observed usage earns them.
