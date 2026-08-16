# Prompting

## Proposal

Build a small Langfuse-backed application for repeatable prompt evaluation and iteration. The primary artifact is prompt text, usually stored in Markdown, while Target runtimes remain external systems that execute the prompt with a message history and a selected model.

The product should make useful prompt-review instincts repeatable with little setup or UI navigation. It is an 80/20 workflow for improving real prompts, not a scientific benchmark laboratory, model-distillation system, universal agent platform, or replacement for Langfuse.

## Product Shape

Prompting has three independent surfaces:

- The existing coding-agent baseline uses `design-agent-prompt` to edit prompt Markdown and `agent-test-bench` to run the standalone BuildingAI agent.
- The application backend runs opaque Targets, LLM judges, LangGraph workflows, and Langfuse experiments without importing either skill or the standalone bench.
- A later Operator, UI, or MCP interface may call the same backend, but none is required for the evaluation kernel.

## Evaluation Model

- A Target is any opaque agent that exposes a configured model ID and an asynchronous input-output invocation.
- A Target receives any evaluator case input and returns any judgeable output, while the optional adapters support strings and message histories and expose their configured model ID.
- Fixed-history N+1 evaluation supplies one complete conversation and generates exactly one next response.
- Assistant tool calls and matching tool-result messages remain part of the history; long tool results may be shortened, but unmatched calls must not be created by cropping.
- Each run supplies a list of criteria, and one structured-output call evaluates all criteria for each judge model.
- A judge model may be supplied as one model or a list, and multiple judges run independently with model attribution on every score.
- A Target model may be supplied as one model or a list; a higher-level caller expands round-robin or all-model runs before invoking the evaluator graph with one model-specific Target.
- The workflow may skip a judge whose configured model ID equals the Target model ID.
- Boolean, categorical, numeric, text, and correction criteria remain invocation configuration rather than semantic subclasses such as `LanguageGate` or `IntentionGate`.
- Langfuse is the required system of record for experiments, traces, scores, comparisons, and future datasets.

## What to Build

1. Keep provider configuration and OpenAI-compatible LangChain clients explicit and independently usable.
2. Keep the evaluator Target boundary SDK-agnostic while retaining AI SDK and LangChain adapters as optional integration conveniences.
3. Run invocation-supplied criteria through one or more LLM judges and persist attributed structured results through Langfuse experiments.
4. Use LangGraph for explicit workflow state and fan-out while keeping the first end-to-end graph simple.
5. Add reusable datasets, aggregation, disagreement handling, an Operator, UI, or MCP only when concrete usage requires them.

## What Not to Build

- A universal agent profile, message protocol, runtime configuration, or tool schema.
- A backend dependency on repo-local skills, the standalone bench, or BuildingAI configuration.
- Another Langfuse dashboard, prompt registry, trace viewer, annotation system, or dataset editor.
- Mandatory statistical ceremony, large judge ensembles, fixed model roles, or universal evaluation criteria.
- A multi-turn simulator when a complete history plus one next response is sufficient.
- Provider-specific guarantees for metadata that the underlying runtime does not preserve.
- Operator, filesystem, revision, UI, or MCP machinery inside the evaluation kernel.

## Current Direction

The first useful backend is a required Langfuse experiment around an opaque Target invocation and one or more judge models. The evaluator owns only the input-output boundary and model attribution, while optional integrations may preserve native framework behavior outside the graph.

The existing coding-agent workflow remains a separate manual way to edit and test prompts. A later user-facing interface should call the same backend rather than duplicate evaluation behavior.
