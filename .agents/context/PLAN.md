# Prompting Plan

## Objective

Deliver a transport-neutral evaluation API that evaluates prompt-driven Target runs through one or more LLM judges, optionally persists experiments through Langfuse, and preserves native AI SDK and LangChain message behavior.

This plan is grouped by work area rather than sequence. A checked item means the behavior exists and has relevant proof; an unchecked item is pending or still needs an end-to-end review.

## Current Flow

```text
evaluate(Target, cases with inline criteria)
-> Evaluator graph
-> Prompt text or complete message history
-> Target generates one response
-> Judges graph fans out across configured judge models
-> Each judge evaluates every configured criterion in one structured-output call
-> Evaluator graph returns attributed scores, comments, and evidence
-> Configured Langfuse persistence captures the same run
```

## Coding-Agent Baseline

- [x] Keep `design-agent-prompt` responsible for prompt-design judgment and direct Markdown edits.
- [x] Keep `agent-test-bench` responsible for standalone BuildingAI cases, runner operation, traces, and result review.
- [x] Keep both skills independent from the Prompting backend.
- [x] Keep the Prompting backend independent from the standalone bench and its profile format.

## Configuration and Clients

- [x] Load provider credentials and configurable endpoints from the environment.
- [x] Load the private model catalogue from `.config.yaml` with `.config.yaml.example` as the committed template.
- [x] Route requested models through configured OpenAI-compatible platforms with credential-presence fallback.
- [x] Expose LangChain chat and embedding clients without putting provider routing in evaluator logic.
- [x] Make Exa MCP tools available without attaching them to a Target or verifier by default.
- [x] Require Langfuse credentials when constructing Langfuse clients and telemetry.
- [x] Evaluate without Langfuse persistence when both credentials are absent and reject partial credential configuration.
- [ ] Re-run focused live chat, embedding, and external-tool smokes after client changes.

## Target Adapters

- [x] Accept any Target that exposes a configured model ID and an asynchronous `invoke` operation.
- [x] Keep AI SDK and LangChain adapters optional and outside the evaluator graph's runtime contract.
- [x] Accept a string or a supported message history as input.
- [x] Preserve native AI SDK `ModelMessage[]` and native LangChain `BaseMessage` histories.
- [x] Accept LangChain-compatible message tuples and message objects through LangChain coercion.
- [x] Translate text LangChain histories into AI SDK messages when the AI SDK adapter receives them.
- [x] Preserve assistant tool-call IDs, names, and arguments across the LangChain-to-AI-SDK boundary.
- [x] Preserve matching `ToolMessage` results, including success or error status, across the LangChain-to-AI-SDK boundary.
- [x] Preserve Gemini thought signatures in native LangChain serialization and LangChain-to-AI-SDK tool-call conversion.
- [x] Keep structured output as `invokeStructured` on each adapter rather than another adapter family.
- [x] Return each adapter runtime's message output plus the configured model ID without exposing provider runtime metadata.
- [x] Reject unsupported rich cross-framework histories instead of guessing.
- [ ] Prove one complete live AI SDK Target run through the structural evaluator boundary.
- [ ] Prove one complete live LangChain Target run through the structural evaluator boundary.

## Target Model Selection

- [x] Accept one Target model or a unique list in the model-run planner.
- [x] Support round-robin case assignment as the default list strategy.
- [x] Support an `all` strategy that runs every case on every Target model.
- [x] Keep Target-run allocation in a higher-level caller so the evaluator graph continues to receive one model-specific Target.
- [ ] Integrate the model-run planner into a backend, CLI, or MCP host that resolves Targets before calling the evaluation API.

## Criteria and Judges

- [x] Accept a non-empty invocation-supplied criterion list for each case.
- [x] Support Boolean, categorical, numeric, text, and correction result contracts.
- [x] Generate unique internal criterion names from the public case criteria, validate unique categories and numeric ranges, and require exactly one matching result per criterion.
- [x] Build the judge prompt only from the criterion types actually present.
- [x] Evaluate all configured criteria in one structured-output call per judge model.
- [x] Accept one judge model or a unique list without introducing a separate panel abstraction.
- [x] Fan out judge models through LangGraph and retain one report per model.
- [x] Keep criterion meaning in each invocation rather than semantic evaluator subclasses.
- [x] Keep blocking, passing, aggregation, and weighting outside the judge class hierarchy.
- [ ] Add aggregation or disagreement handling only after a real comparison needs a decision beyond per-model results.

## Langfuse Experiments

- [x] Treat Langfuse as optional experiment persistence rather than the owner of evaluation execution.
- [x] Initialize the Langfuse client and OpenTelemetry span processor only when both credentials are configured.
- [x] Run the same Target and judge subgraphs regardless of Langfuse configuration, then persist completed outputs and scores through the Langfuse Experiment SDK when configured.
- [x] Convert structured judge results into native Langfuse Boolean, categorical, numeric, and text evaluations.
- [x] Persist judge model, criterion, evidence, and reasoning with each score when Langfuse is configured.
- [x] Flush experiment and telemetry data before returning and shut down both clients when the runner closes.
- [x] Apply `maxConcurrency` whether or not Langfuse persistence is configured.
- [ ] Verify categorical, numeric, text, and correction records in the Langfuse UI or API.
- [ ] Promote stable local examples into a Langfuse dataset when cross-run comparison becomes useful.

## Evaluator Graphs

- [x] Expose one evaluator graph whose topology is independent from optional Langfuse persistence.
- [x] Mount a per-case evaluation subgraph that invokes the Target and uses the judges graph as a nested subgraph.
- [x] Fan one case out to one or more judge models inside the judges subgraph and collect their reports.
- [x] Keep Langfuse configuration out of graph routing by handling optional conversion and persistence inside neutral finalization.
- [x] Delegate the compact public evaluation API to the evaluator graph rather than maintaining a parallel execution path.
- [x] Resolve each case's inline criteria inside the evaluator graph's evaluation run.
- [x] Return evaluator-owned results from the graph whether or not Langfuse persistence is configured.
- [x] Allow the evaluator graph to skip a judge model whose configured ID equals the Target model ID.
- [x] Keep case concurrency as a public graph input regardless of whether Langfuse persistence is configured.
- [x] Reuse one process-lifetime Langfuse runner when configured so repeated graph invocations retain the registered telemetry provider.
- [x] Keep the initial evaluator flow straight rather than inventing unjustified stages or fixers.
- [ ] Decide whether later quality improvements justify tiered judges, focused reruns, or human review.
- [ ] Add a branch only after its routing decision and stopping condition are concrete.

## Fixed-History N+1 Evaluation

- [x] Define the first multi-turn shape as one complete prior message history plus one generated next response.
- [x] Preserve tool calls and tool-result messages needed for a valid continuation.
- [x] Avoid a custom replay-loop or conversation-simulator abstraction.
- [x] Add a minimal `evaluate()` example that runs fixed-history N+1 cases through the evaluator graph.
- [ ] Decide how long tool outputs are shortened while preserving `tool_call_id`, tool name, status, and enough evidence for continuation and evaluation.

## Latest Verification Evidence

- [x] Formatting, lint, typecheck, and deterministic adapter smokes passed after the current adapter simplification.
- [x] The compact public API passed schema, import-boundary, formatting, lint, and typecheck verification with adapters and graph internals kept opt-in.
- [x] A live fixed-target smoke returned one judged public result with both Langfuse credentials absent, while a partial credential configuration failed before Target execution.
- [x] A live fixed-output Target run through the structural evaluator boundary persisted its input, output, experiment observation, and attributed Boolean score in Langfuse without an expected output.
- [x] The public fixed-history N+1 example passed three live cases covering prior facts, corrections, and completed tool-result reuse without Langfuse persistence.
- [x] A deterministic smoke preserved parallel LangChain tool calls, matching success and error `ToolMessage` results, native AI SDK messages, and native LangChain messages.
- [x] Live Gemini 3.6 smokes proved native LangChain invoke and stream continuation, a native AI SDK tool loop, and LangChain-to-AI-SDK continuation with matching call and result IDs.
- [x] A live Gemini 3.5 LangChain smoke produced a tool call, accepted its matching `ToolMessage`, and completed the continuation.

## Later Product Areas

- [ ] Add a neutral Operator only after users need application-managed prompt editing.
- [ ] Add direct prompt persistence and simple restore only when the application owns prompt storage.
- [ ] Add a minimal UI that starts evaluations and links to Langfuse rather than rebuilding Langfuse views.
- [ ] Add MCP only when the backend API or headless caller is insufficient for external agents.

## Next Work

1. Add a backend, CLI, or MCP host that resolves Targets and expands model runs before invoking the evaluation API.
2. Verify categorical, numeric, text, and correction score records through the Langfuse API.
3. Define how long tool outputs are shortened in fixed-history cases without breaking continuation or evaluation evidence.

## Open Decisions

- [x] Keep Target-run allocation in a higher-level caller.
- [ ] Decide when judge disagreement needs aggregation, focused reruns, or human review.
- [ ] Decide when local examples should become reusable Langfuse datasets.
- [ ] Decide whether the later Operator needs application-owned storage, scoped Markdown tools, or only an external-agent interface.
