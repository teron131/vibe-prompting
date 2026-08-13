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
- **Evaluation:** Applies LLM-backed judgments to observed runs through boolean, categorical, numeric, text, or correction outputs. Comparative results use structured score types, while text feedback and corrected outputs remain explicit standalone results.
- **Evaluator workflow:** Coordinates cases, Target runs, evaluator calls, repetitions, and Langfuse recording. LangGraph is the application entrypoint and owns experiment execution as a workflow stage; each Target output can be judged by several configured evaluator models while LangChain supplies model and agent helpers where needed.
- **Operator:** A later neutral interface for creating or editing prompt text under user direction. It is separate from evaluation and is not inherently an optimizer.
- **Langfuse:** Owns published datasets, experiments, traces, scores, annotations, comparisons, and complete run history. The evaluator runner integrates judges with the Langfuse SDK; individual judge classes remain independent from experiment orchestration and persistence.

## Evaluation Direction

- Start with one thin end-to-end run and one or two LLM judges over observable evidence.
- Require concise evidence for judgments rather than relying on an unexplained overall vibe.
- Cluster judges by their primary output: boolean for binary checks, categorical for explicit qualitative labels, and numeric for bounded quantitative judgments.
- Use text for standalone qualitative feedback and correction for a proposed replacement output rather than forcing either into a comparative score.
- Treat blocking gates as evaluator-workflow policy applied to a judge result, not as another judge family.
- Keep judge reasoning in score comments and evidence metadata rather than using unaggregatable text as the primary score.
- Add datasets, repetitions, aggregation, weighting, gates, unknown states, attribution, and workflow routing only when concrete runs require them.
- Keep use-case-specific intention, language, scope, and tool expectations in evaluator configuration rather than hard-coding universal evaluation criteria.
- Treat models as an available pool and assign them per run rather than permanently binding models to roles.
- Use scores for comparison and prioritization, not as claims of scientific objectivity.

## What to Build

1. Establish provider configuration and LangChain clients for chat, embeddings, and external tools.
2. Define the minimal Target protocol and prove it with an application-owned implementation independent of the standalone bench.
3. Build reusable LLM-judge objects, then connect them to a thin Langfuse-backed evaluator runner and LangGraph workflow as concrete orchestration needs appear.
4. Add a neutral Operator and prompt persistence only after the evaluation backend is useful.
5. Add a minimal UI for nontechnical users, then MCP or another external-agent interface only if the backend API is insufficient.

## What Not to Build

- A universal target-runtime configuration schema.
- A backend dependency on repo-local skills, the standalone bench, or its agent-profile format.
- Another Langfuse dashboard, dataset editor, trace viewer, annotation system, or prompt registry.
- A scientific evaluation framework with mandatory calibration, large judge ensembles, or statistical ceremony.
- Deterministic and LLM evaluators forced behind one generic mechanism when this application currently requires only LLM judges.
- Universal evaluation criteria forced onto every use case.
- Teacher/student terminology or distillation machinery.
- Provider-specific Target contracts or permanently fixed model roles.
- Filesystem, revision, Operator, UI, or MCP machinery inside the evaluation kernel.
- A general coding-agent runtime, arbitrary repository access, or shell execution for the built-in Operator.
- Full local duplication of Langfuse data or bidirectional synchronization.
- Langfuse client, telemetry, experiment, or score-writing responsibilities inside individual judge classes.

## Recommended Foundation

Keep the coding-agent baseline intact as a separate way to edit and test prompts. Build the application independently with LangChain clients, a narrow Target protocol, output-shaped LLM judges, LangGraph workflow composition where earned, and Langfuse as the evaluation system of record.

The backend should use Langfuse by default once the evaluator runner is implemented. One process-wide `LANGFUSE_ENABLED=false` opt-out should select local-only execution; enabled operation must fail clearly at startup when Langfuse credentials are missing rather than silently discarding evaluation history.

The later Operator should work with prompt text through the narrowest practical interface. Direct prompt storage is preferable when the application owns persistence; workspace-scoped read, write, and patch tools are secondary support for local Markdown workflows. Full coding agents remain optional external operators and use their own tools.
