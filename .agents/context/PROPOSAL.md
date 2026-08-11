# Prompting

## Proposal

Build a small Langfuse-backed application for repeatable prompt evaluation and iteration. Its product input is prompt text, usually stored in Markdown, plus messages or examples and a requested model. Target runtimes remain external to that prompt contract.

The goal is an 80/20 workflow that turns useful but informal review concerns into repeatable evidence with little human navigation. It is not a scientific benchmark laboratory, model-distillation system, universal agent platform, or replacement for Langfuse.

## Existing Coding-Agent Baseline

The repo-local skills and `agent-test-bench` form an independent manual workflow: a coding agent uses `design-agent-prompt` to edit prompt Markdown, then uses `agent-test-bench` to run and inspect the existing standalone agent.

This baseline helps reveal useful prompting and testing practices, but it is not a layer of the application backend. The application must not import the skills, depend on the bench, adopt its profile format, or wrap the standalone runner as its first Target implementation.

## Why

The manual baseline already surfaces practical concerns such as intention, language behavior, scope, tool use, response quality, consistency, regression, and overfitting. The application should make selected judgments repeatable, measurable, and observable without pretending that subjective quality has become objective science.

Evaluator schemas and workflow complexity should be extracted from real application runs rather than copied from the skills or designed exhaustively in advance.

## Application Boundaries

- **Prompt:** The editable string being tested. It may be supplied directly or loaded from Markdown, but its storage layout is not part of the evaluation contract.
- **Model clients:** Resolve available chat and embedding providers through LangChain while keeping provider configuration at the external boundary.
- **Target protocol:** Runs prompt text with normalized messages and a requested model identifier. A Target implementation owns its framework, tools, loop mechanics, and configuration, then returns produced messages, the actual model identifier, and best-effort metadata.
- **Evaluation:** Applies deterministic or model-backed judgments to observed runs. Its result shapes remain provisional until repeated use proves stable concepts.
- **Evaluator workflow:** Coordinates cases, Target runs, evaluator calls, repetitions, and Langfuse recording. LangGraph implements the workflow when graph-shaped control is useful; LangChain supplies model and agent helpers where needed.
- **Operator:** A later neutral interface for creating or editing prompt text under user direction. It is separate from evaluation and is not inherently an optimizer.
- **Langfuse:** Owns published datasets, experiments, traces, scores, annotations, comparisons, and complete run history.

## Evaluation Direction

- Start with one thin end-to-end run and one or two provisional judgments over observable evidence.
- Require concise evidence for judgments rather than relying on an unexplained overall vibe.
- Use binary or deliberately graded outputs only where they make comparisons more useful.
- Add datasets, repetitions, aggregation, weighting, gates, unknown states, attribution, and workflow routing only when concrete runs require them.
- Keep use-case-specific intention, language, scope, and tool expectations in evaluator configuration rather than hard-coding one universal rubric.
- Treat models as an available pool and assign them per run rather than permanently binding models to roles.
- Use scores for comparison and prioritization, not as claims of scientific objectivity.

## What to Build

1. Establish provider configuration and LangChain clients for chat, embeddings, and external tools.
2. Define the minimal Target protocol and prove it with an application-owned implementation independent of the standalone bench.
3. Build a thin Langfuse-backed evaluator workflow and extract reusable evaluator objects from observed needs.
4. Add a neutral Operator and prompt persistence only after the evaluation backend is useful.
5. Add a minimal UI for nontechnical users, then MCP or another external-agent interface only if the backend API is insufficient.

## What Not to Build

- A universal target-runtime configuration schema.
- A backend dependency on repo-local skills, the standalone bench, or its agent-profile format.
- Another Langfuse dashboard, dataset editor, trace viewer, annotation system, or prompt registry.
- A scientific evaluation framework with mandatory calibration, large judge ensembles, or statistical ceremony.
- A universal rubric forced onto every use case.
- Teacher/student terminology or distillation machinery.
- Provider-specific Target contracts or permanently fixed model roles.
- Filesystem, revision, Operator, UI, or MCP machinery inside the evaluation kernel.
- A general coding-agent runtime, arbitrary repository access, or shell execution for the built-in Operator.
- Full local duplication of Langfuse data or bidirectional synchronization.

## Recommended Foundation

Keep the coding-agent baseline intact as a separate way to edit and test prompts. Build the application independently with LangChain clients, a narrow Target protocol, LangGraph workflow composition where earned, and Langfuse as the evaluation system of record.

The later Operator should work with prompt text through the narrowest practical interface. Direct prompt storage is preferable when the application owns persistence; workspace-scoped read, write, and patch tools are secondary support for local Markdown workflows. Full coding agents remain optional external operators and use their own tools.
