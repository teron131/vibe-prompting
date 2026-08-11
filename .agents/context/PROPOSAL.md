# Prompting

## Proposal

Turn the current prompt-design skills and standalone agent test bench into a repeatable prompt-improvement workflow for nontechnical users and coding agents.

Users should be able to describe an agent in ordinary chat, optionally provide examples or a dataset, and receive measurable evaluation evidence and reviewable Agent Profile edits. The baseline remains simple local files: structured JSON or YAML configuration plus readable Markdown prompts. Langfuse provides the evaluation system of record without becoming a UI users must navigate for routine work.

This is an 80/20 improvement tool for getting agents to a decent Pareto result with little manual ceremony. It is not a scientific benchmark laboratory, model-distillation system, or replacement for Langfuse.

## Why

The existing skills already capture useful judgment about intention, language, scope, tool use, response quality, consistency, regression, and overfitting. Today, much of that judgment depends on repeated conversation with a coding agent and manually interpreted test runs.

Prompting should turn those recurring checks into editable, structured checkpoints that are repeatable, measurable, observable, and still understandable to users. Domain nuance continues to come from users; the system supplies a practical baseline rather than pretending to know every business domain.

## Core Shape

- **Operator:** A neutral, bounded ReAct agent that follows user instructions over local Agent Profile artifacts and evaluation evidence. The built-in Operator uses workspace-scoped file tools plus evaluation-specific tools rather than a general coding-agent runtime; external coding agents may use the same backend, and neither path is inherently restricted to improvement actions.
- **Evaluator Agent:** The LangGraph agent that coordinates an evaluation job, invokes evaluation operations across one or more Langfuse experiments, and makes bounded routing decisions. Its nodes do not inherently require an LLM.
- **Evaluation:** The independently usable capability containing reusable evaluators, checkpoint and result schemas, and model-judge prompts. It scores already-produced inputs and outputs without owning target execution, LangGraph routing, or Langfuse experiment lifecycle.
- **Target Agent:** The chat and tool-loop agent being evaluated. It is accessed through an implementation-agnostic adapter rather than coupled to one provider or agent framework.

The editable Agent Profile contains references to its Markdown prompt, evaluator definitions, and checkpoint pack plus tool selection and descriptions, model settings, and loop limits. Evaluation Plans own example strings, canonical cases or dataset references, model-role assignments, repetitions, concurrency, and budgets. Tool implementations and arbitrary application source code remain outside the optimization surface.

## Evaluation Method

- Ship editable default checkpoints for intention, language behavior, tool usage, response scope, and other recurring concerns.
- Mark each checkpoint as required, scored, or not applicable for the project.
- Default to binary `fail` or `pass`, allow `partial` only for deliberately graded criteria, and distinguish `unknown` from `not_applicable`; both are excluded from aggregation with an explicit reason.
- Require concise evidence for every judgment.
- Allow weights and hard gates, so a high average cannot hide a critical failure.
- Treat models as an available pool. Assign them to target and evaluator roles per run rather than permanently binding one model to one role.
- Use scores for comparison and prioritization, not as a claim that subjective agent quality has become objective science.

## Artifacts and Ownership

- Local JSON, YAML, and Markdown files are authoritative for editable Agent Profile definitions, checkpoints, examples, and configuration.
- The workspace boundary owns recognized artifact paths, JSON, YAML, and Markdown loading, referenced prompt resolution, and writes of selective local evidence; callers do not reconstruct those rules independently.
- Langfuse is authoritative for complete datasets, experiments, traces, scores, annotations, and run history.
- Local evaluation snapshots copy only the working evidence needed to continue: the evaluated artifact revision, aggregate and aspect scores, failed or flagged cases, relevant message transcripts, available run metadata, and Langfuse references.
- A small local revision store records complete immutable artifact snapshots in a linear parent-linked history. The current files remain directly editable; comparisons are computed on demand, and restoring an older snapshot appends a new revision rather than introducing candidate or acceptance states.
- Successful raw traces and the complete operational record remain in Langfuse. Do not build two-way synchronization.

## What to Build

1. Canonical Agent Profile, evaluator, checkpoint, case, result, and snapshot schemas reflected in the existing skills.
2. A small workspace boundary for the recognized local JSON, YAML, and Markdown artifacts, including linear full-snapshot revision history, comparison, and revert.
3. A configurable LangGraph Evaluator Agent integrated with the independent evaluation capability, Langfuse experiments, and an agnostic Target Agent adapter contract.
4. A built-in ReAct Operator that acts through bounded workspace and evaluation tools and presents resulting diffs and evidence for users to decide.
5. A minimal chat-oriented UI after the backend is proven.
6. An MCP or other external-agent interface only if the ordinary backend API or script is insufficient.

## What Not to Build

- Another Langfuse dashboard, dataset editor, trace viewer, annotation system, or prompt registry.
- A scientific evaluation framework with mandatory calibration, large judge ensembles, or statistical ceremony.
- A universal rubric forced onto every business agent.
- Teacher/student terminology or distillation machinery.
- Provider-specific Target Agent contracts or permanently fixed model roles.
- A general coding-agent runtime, arbitrary repository access, or shell execution for the built-in Operator.
- Candidate, acceptance, promotion, branch, merge, rebase, or delta-storage machinery for local artifact revisions.
- Full local duplication of Langfuse data or bidirectional synchronization.
- UI or MCP logic that duplicates the backend pipeline.

## Recommended Foundation

Build the evaluation backend on Langfuse and keep Langfuse Cloud and self-hosted Langfuse interchangeable through configuration. Use LangGraph JS for the Evaluator Agent's executable state and conditional workflow. Keep reusable evaluation logic outside the agent so nodes may compose deterministic checks, Target Agent adapter calls, aggregation, or LLM-backed evaluators; use LangChain where its agent, model, middleware, or structured-output helpers are useful. Implement the built-in Operator as a LangChain ReAct agent with workspace-root-bounded list, read, write, patch, diff, history, and revert tools plus a small set of evaluation-specific tools. Store complete immutable snapshots because prompt workspaces are small, and tie every evaluation to the exact revision ID and content hash it observed. Reuse the existing TypeScript tool-loop runtime as the default Target Agent adapter while keeping its public contract limited to normalized messages, model identity, and best-effort metadata.

Full coding agents such as Pi, OpenCode, or Codex remain optional external operators. They may act through the same backend API, future MCP surface, or local artifacts without becoming dependencies of the evaluation kernel or the built-in Operator.

Langfuse owns datasets, per-experiment item iteration, concurrency, error isolation, traces, scores, and comparison. LangGraph owns the evaluation-job workflow around those experiments, including state, conditional transitions, bounded follow-up experiments, and missing-evidence handling. Langfuse graph views visualize observed executions; they are not a workflow runtime.
