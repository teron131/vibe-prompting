/** Executes isolated prompt edits through the shared SDK runtime while leaving durable revisions to Prompt System. */

import { type ModelContext, standaloneModelContext } from "../../clients/llm/context.ts";
import type { ModelConfig } from "../../config/index.ts";
import { createExaSearchTool } from "../tools/exa.ts";
import { createPromptEditTools } from "../tools/prompt-library.ts";
import { createScopedDocument } from "../tools/scoped-fs.ts";
import { type AgentStreamEvent, projectEvent } from "./events.ts";
import { adaptTools, createAgentRuntime } from "./runtime.ts";

export type PromptEdit = {
  message: string;
  markdown: string;
  model: ModelConfig;
};

export type PromptEditInput = {
  modelContext?: ModelContext;
  markdown: string;
  instruction: string;
  modelId: string;
  signal?: AbortSignal;
};

/** Runs a prompt-edit request while discarding stream events for the non-streaming facade. */
export async function editPrompt(input: PromptEditInput): Promise<PromptEdit> {
  return streamPromptEdit(input, () => undefined);
}

/** Runs an edit against one private document and returns its content without persisting a revision. */
export async function streamPromptEdit(
  input: PromptEditInput,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<PromptEdit> {
  const modelContext = input.modelContext ?? standaloneModelContext;
  const document = createScopedDocument(input.markdown);

  input.signal?.throwIfAborted();
  const runtime = createAgentRuntime(
    input.modelId,
    adaptTools(
      [
        ...createPromptEditTools(document),
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
