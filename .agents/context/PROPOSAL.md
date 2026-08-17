# Prompting

## Proposal

Build a small application for repeatable prompt evaluation and iteration, with optional Langfuse persistence. The primary artifact is prompt text, usually stored in Markdown, while Target runtimes remain external systems that execute the prompt with a message history and a selected model.

The product should make useful prompt-review instincts repeatable with little setup or UI navigation. It is an 80/20 workflow for improving real prompts, not a scientific benchmark laboratory, model-distillation system, universal agent platform, or replacement for Langfuse.

## Product Shape

Prompting has three independent surfaces:

- The existing coding-agent baseline uses `design-agent-prompt` to edit prompt Markdown and `agent-test-bench` to run the standalone BuildingAI agent.
- The application backend exposes one transport-neutral evaluation call over opaque Targets and LLM judges, with optional Langfuse persistence and no dependency on either skill or the standalone bench.
- A later Operator, CLI, UI, or MCP interface may call the same backend, but none is required for the evaluation kernel.

## Evaluation Model

- A Target is any opaque agent that exposes a configured model ID and an asynchronous input-output invocation.
- A Target receives any evaluator case input and returns any judgeable output, while the optional adapters support strings and message histories and expose their configured model ID.
- Fixed-history N+1 evaluation supplies one complete conversation and generates exactly one next response.
- Assistant tool calls and matching tool-result messages remain part of the history; long tool results may be shortened, but unmatched calls must not be created by cropping.
- Each case keeps its criteria beside its raw input, and one structured-output call evaluates all of that case's criteria for each judge model.
- A judge model may be supplied as one model or a list, and multiple judges run independently with model attribution on every score.
- A Target model may be supplied as one model or a list; a higher-level caller expands round-robin or all-model runs before invoking the evaluator graph with one model-specific Target.
- The workflow may skip a judge whose configured model ID equals the Target model ID.
- Boolean, categorical, numeric, text, and correction criteria remain invocation configuration rather than semantic subclasses such as `LanguageGate` or `IntentionGate`.
- Langfuse stores experiments, traces, scores, comparisons, and future datasets when configured, while the evaluator returns the same results without Langfuse persistence when credentials are absent.

## What to Build

1. Keep provider configuration and OpenAI-compatible LangChain clients explicit and independently usable.
2. Keep the evaluator Target boundary SDK-agnostic while retaining AI SDK and LangChain adapters as optional integration conveniences.
3. Run invocation-supplied criteria through one or more LLM judges, return attributed structured results directly, and persist them through Langfuse experiments when configured.
4. Use `evaluatorGraph` as the backend orchestration surface while keeping graph state out of the public request.
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

The first useful backend is `evaluate(target, request)`, which normalizes the compact public contract and delegates the complete evaluation workflow to `evaluatorGraph`. The request contains only cases and inline criteria, the result contains plain case evaluations, and optional integrations may preserve native framework behavior outside this boundary.

The existing coding-agent workflow remains a separate manual way to edit and test prompts. A later user-facing interface should call the same backend rather than duplicate evaluation behavior.
