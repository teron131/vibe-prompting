# Prompting Plan

## Objective

Deliver a minimal Prompt Operator that edits durable Markdown prompts through a safely scoped file workspace and can call the existing evaluator or Exa search only when the user asks for those capabilities.

## Current Product Flow

```text
Browser loads the current PostgreSQL revision
-> user edits Markdown and submits a change request
-> API rejects stale revision IDs
-> one disposable prompt.md is initialized from the visible Markdown
-> Operator reads and locally edits that file
-> optional Exa search or focused evaluation runs only when requested
-> one successful transaction appends any manual revision and then any changed Operator revision
-> disposable workspace is removed
-> browser receives the new current revision
```

## Local Lifecycle

1. Copy `.config.yaml.example` to `.config.yaml` and keep only the models this installation can serve.
2. Copy `.env.example` to `.env` and set the corresponding provider keys, `DATABASE_URL`, and optionally `EXA_API_KEY` and both Langfuse keys.
3. Start PostgreSQL with `brew services start postgresql@17`.
4. Run `pnpm run db:setup` to create the named database when absent and apply unapplied migrations.
5. Run `pnpm run server` for the browser and HTTP API, or `pnpm run dev` to start both the HTTP and evaluation MCP hosts.
6. Open `http://127.0.0.1:3000/`; generated OpenAPI documentation is available at `/docs`.

The default local database URL is `postgresql://localhost/vibe_prompting`. Any normal PostgreSQL-compatible hosted connection URL can replace it without changing application storage code.

## Completed 0.7.0 Slice

### Configuration and Clients

- [x] Load the private model catalogue from `.config.yaml` with `.config.yaml.example` as its template.
- [x] Select the Operator, target, and judge models from the configured catalogue instead of hard-coding a product model.
- [x] Route configured models through Gemini, CLIProxyAPI, or a generic OpenAI-compatible endpoint.
- [x] Make Exa's remote MCP web-search tool available to the Operator with an optional API key.
- [x] Evaluate without Langfuse when both credentials are absent and reject partial Langfuse credentials before execution.

### Prompt Storage

- [x] Store stable prompt identity separately from immutable Markdown revisions in PostgreSQL.
- [x] Apply numbered SQL migrations under one advisory lock and record applied versions.
- [x] Create the configured local database from `pnpm run db:setup` when it does not exist.
- [x] Persist an initial user revision when creating a prompt.
- [x] Persist visible manual changes before an Operator revision.
- [x] Reject stale expected revision IDs with a conflict instead of overwriting newer state.
- [x] Keep a newly created prompt visible and retryable when the following Operator call fails.

### Operator

- [x] Compose the Operator with the OpenAI Agents SDK and the caller-selected configured model.
- [x] Materialize one isolated `prompt.md` for each run and remove it afterward.
- [x] Expose only `read_prompt` and unique exact-replacement `edit_prompt` filesystem operations.
- [x] Preserve unrelated prompt content by instructing the Operator to make localized replacements.
- [x] Expose focused evaluation as a native in-process tool rather than MCP.
- [x] Expose only Exa web search through remote MCP.
- [x] Instruct the Operator not to search or evaluate every routine change.

### Evaluation

- [x] Keep `evaluate(target, request)` transport-neutral and callable by application code, the Operator tool, and external consumers.
- [x] Accept opaque Targets and inline Boolean, categorical, numeric, text, or correction criteria.
- [x] Fan out multiple judge models and preserve per-judge attribution, comments, and evidence.
- [x] Keep optional Langfuse persistence outside Target and judge ownership.
- [x] Keep AI SDK and LangChain Target adapters optional and outside the evaluator graph's runtime contract.
- [x] Preserve supported native message histories and Gemini continuation signatures at their client boundaries.

### Application Adapters

- [x] Serve a temporary browser UI for creating, loading, manually editing, and Operator-editing prompts.
- [x] Expose prompt create, list, and Operator-edit HTTP endpoints.
- [x] Expose direct model evaluation over HTTP.
- [x] Mirror external evaluation as an optional MCP tool without routing the Operator through that host.
- [x] Expose configured model metadata to the browser and MCP clients.
- [x] Expose a lightweight `/healthz` process-readiness endpoint for a future host.

## Verification Evidence

- [x] Formatting, lint, typecheck, frozen-lockfile, and diff checks passed for the 0.7.0 implementation.
- [x] A live Gemini 3.7 Operator run made a localized prompt edit through the scoped file tools.
- [x] An explicit Operator evaluation used configured Gemini 3.7 target and judge models and did not rewrite an unchanged prompt.
- [x] A disposable PostgreSQL lifecycle test proved migration, initial creation, manual revision, Operator revision, and stale-write conflict behavior.
- [x] A browser-backed disposable database test proved that a prompt survives an Operator failure and that retrying appends the correct revision chain.
- [x] The MCP host started successfully and reported healthy without becoming a dependency of the Operator workflow.

## Deployment Plan

Deployment remains deferred until the local workflow is worth sharing.

The planned first demo is one Cloud Run Fastify service plus Cloud SQL for PostgreSQL. The database remains standard PostgreSQL behind `DATABASE_URL`, so application storage code stays portable.

Before deployment:

- [ ] Validate the Operator on real prompts and fix only blocking UI problems.
- [ ] Add a production container/start path and listen on `0.0.0.0:$PORT`.
- [ ] Add access control and request limits for model-backed routes.
- [ ] Store secrets in Google Secret Manager and run `pnpm run db:setup` against Cloud SQL.
- [ ] Deploy only the Fastify app with Cloud Run request billing, zero minimum instances, and one maximum instance.
- [ ] Verify health, prompt creation, Operator editing, revision persistence after a cold start, evaluation, logs, and actual usage.

## Next Work

1. Use the temporary UI with real prompts.
2. Improve only workflow problems observed during that use.
3. Add revision history or restore when users need it.
4. Deploy Cloud Run plus Cloud SQL only when sharing becomes useful.
5. Add evaluation aggregation, reusable datasets, or richer target orchestration only when a real comparison requires them.

## Deliberate Non-Goals

- Unrestricted native filesystem tools.
- Automatic evaluation after every edit.
- A full coding-agent shell, task list, or general-purpose sandbox.
- Prompt storage inside the temporary Operator workspace.
- MCP as an internal application boundary.
- Deployment before the local product loop is effective.
