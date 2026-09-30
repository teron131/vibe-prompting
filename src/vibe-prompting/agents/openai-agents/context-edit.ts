/** Executes isolated context edits through the shared SDK runtime while leaving durable revisions to Context System. */

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ModelConfig } from "../../config/index.ts";
import { createContextEditTools } from "../tools/context-library.ts";
import { createExaSearchTool } from "../tools/exa.ts";
import { createScopedDocument } from "../tools/hashline.ts";
import { type AgentStreamEvent, projectEvent } from "./events.ts";
import { adaptTools, createAgentRuntime } from "./runtime.ts";

export type ContextEdit = {
  message: string;
  markdown: string;
  model: ModelConfig;
};

export type ContextEditInput = {
  modelContext?: ModelContext;
  markdown: string;
  instruction: string;
  modelId: string;
  signal?: AbortSignal;
};

/** Runs a context-edit request while discarding stream events for the non-streaming facade. */
export async function editContext(input: ContextEditInput): Promise<ContextEdit> {
  return streamContextEdit(input, () => undefined);
}

/** Runs an edit against one private document and returns its content without persisting a revision. */
export async function streamContextEdit(
  input: ContextEditInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ContextEdit> {
  const modelContext = input.modelContext ?? standaloneModelContext;
  const document = createScopedDocument(input.markdown);

  input.signal?.throwIfAborted();
  const runtime = createAgentRuntime(
    input.modelId,
    adaptTools(
      [
        ...createContextEditTools(document),
        createExaSearchTool(modelContext.readConfig, modelContext.signal),
      ],
      { signal: input.signal },
    ),
    undefined,
    modelContext,
  );
  const run = await runtime.runner.run(runtime.agent, input.instruction, {
    signal: input.signal,
    stream: true,
  });
  const toolNames = new Map<string, string>();
  for await (const event of run) {
    for (const item of projectEvent(event, toolNames)) onEvent(item);
  }
  await run.completed;
  if (run.error) throw run.error;
  if (typeof run.finalOutput !== "string") {
    throw new Error("The model did not return text.");
  }
  return {
    message: run.finalOutput,
    markdown: document.read(),
    model: runtime.model,
  };
}
