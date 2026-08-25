---
name: task-driven-app-improvement
description: Complete real prompt and evaluation work through Vibe Prompting while using observed task friction to guide bounded app, MCP, workflow, and durable-context improvements.
---

# Improve the App Through Real Tasks

Use Vibe Prompting as the workbench for the user's actual task and as the subject of improvement. The task outcome remains primary; app changes are justified by observed work rather than invented roadmaps.

## Boundaries

- Use the application's MCP surface as the normal programmatic client because it shares the Prompt, Target Run, Criteria, and Evaluation owners used by the browser.
- Use the browser when visible interaction, information hierarchy, accessibility, or responsive behavior is the evidence under investigation.
- Inspect or edit source only after the task exposes a reproducible product limitation or the user explicitly asks for app development.
- Treat PostgreSQL records as durable product context and Langfuse as optional trace evidence, not as interchangeable stores.
- Treat `docs/` as upstream or historical reference material that may be useful but may not match the current implementation; do not delete it or import it wholesale into product state.
- Do not recreate a standalone test runtime, parallel evaluator, prompt store, or task database beside the application.
- Preserve normal authorization boundaries: read-only investigation does not authorize prompt, criteria, evaluation, database, deployment, or source mutations beyond the user's task.

## Work the Two Lanes Together

1. Frame the real task in terms of its desired artifact or decision, supplied evidence, constraints, and acceptance criteria.
2. Find and read the relevant saved Prompt Revision, Criterion, Criteria, Target Run, and Evaluation Run before creating replacements.
3. Complete as much of the task as the current app supports through MCP, preserving returned identifiers, versions, status, and artifact links.
4. Record friction when the app causes a wrong result, missing evidence, unnecessary repetition, unclear state, blocked action, or expensive workaround.
5. Classify the friction before changing anything so task context, product defects, adapter gaps, and speculative ideas do not blur together.
6. Make the smallest app change that materially improves the current task or a demonstrated repeated workflow.
7. Replay the same task through the same public surface and compare the result against the original acceptance criteria.
8. Finish with the task outcome first, then any durable context created, app change made, and remaining evidence-backed limitation.

## Classify What the Task Reveals

- **Task context:** Save a Prompt, Criterion, Criteria composition, or other supported product record only when it has durable value beyond the current turn and the write is within scope.
- **Prompt behavior:** Use `design-agent-prompt` for the smallest evidence-backed prompt change, then validate it through a realistic Target Run and Evaluation Run when evaluation adds useful confidence.
- **Product defect:** Reproduce it through MCP or the browser, locate the owning backend or frontend boundary, fix it narrowly, and replay the failing task.
- **MCP gap:** Add or adjust an MCP tool only when the application already owns the underlying operation and the missing adapter blocks useful task work; do not create MCP-only semantics.
- **UX friction:** Preserve the existing interface system, prove the visible problem, and verify the corrected interaction in the browser.
- **Advanced idea:** Defer an idea that is rare, unproven, or not needed for the task; report the observation and what future evidence would earn implementation.
- **Reference finding:** Keep useful upstream material in `docs/` as evidence without treating it as a current product contract.

## Use the MCP Surface Deliberately

- Discover the live MCP schemas before a workflow because tool inputs and available operations can evolve.
- Search, list, and read before create or edit operations, and supply exact expected revisions or versions when the tool contract requires them.
- Use Target Runs for realistic multi-turn behavior and preserve the exact pinned prompt, profile, model, and completed turn that produced the evidence.
- Preview an evaluation batch before starting it when model-call count, judge count, or spend matters, then inspect durable run status and attributed results rather than relying on a transient response.
- Use evaluation search and analytics over the same filters when comparing cases or revisions so aggregate claims remain traceable to the underlying evidence.
- Cancel queued or running work only when the user requests it or continued execution is clearly unnecessary and within the current task's authority.

## Improvement Gate

Implement an app change during task work when the limitation is reproducible, materially affects the result or workflow, has a clear owner, and can be verified by replaying the task. Otherwise complete the task with the current app, preserve the useful observation, and leave the product unchanged.

Do not generalize one model response, one unusual input, or one external-service failure into a product rule. Repeat only enough to distinguish stochastic behavior from a stable prompt, runtime, tool, data, or interface problem.

## Verification

Verify the changed owner with its focused checks, run the repository typecheck and build when source changed, and use MCP or browser proof for the public workflow that motivated the change. Keep durable records only when they are useful product evidence rather than disposable test noise.
