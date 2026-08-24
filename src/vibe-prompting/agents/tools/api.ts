/** Defines framework-neutral tool and toolkit contracts that capability owners implement and runtime adapters translate. */

import type { z } from "zod";

export type AgentToolExecutionContext = {
  actorUserId?: string;
  chatId?: string | null;
  signal?: AbortSignal;
};

export type AgentToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type AgentTool = {
  name: string;
  title?: string;
  description: string;
  parameters: z.ZodObject;
  annotations?: AgentToolAnnotations;
  execute(input: unknown, context: AgentToolExecutionContext): Promise<unknown> | unknown;
};

export type AgentToolkitId =
  | "prompt-library"
  | "criteria-library"
  | "evaluation-runs"
  | "evaluation-results"
  | "target-runs";

/** Owns one ordered capability group and validates toolkit composition before a runtime adapts its tools. */
export abstract class AgentToolkit {
  readonly id: AgentToolkitId;
  readonly tools: readonly AgentTool[];

  protected constructor(id: AgentToolkitId, tools: readonly AgentTool[]) {
    this.id = id;
    this.tools = tools;
  }

  static compose(toolkits: readonly AgentToolkit[]): AgentTool[] {
    const toolkitIds = new Set<AgentToolkitId>();
    const toolNames = new Set<string>();
    const tools: AgentTool[] = [];
    for (const toolkit of toolkits) {
      if (toolkitIds.has(toolkit.id)) throw new Error(`Duplicate agent toolkit: ${toolkit.id}.`);
      toolkitIds.add(toolkit.id);
      for (const tool of toolkit.tools) {
        if (toolNames.has(tool.name)) throw new Error(`Duplicate agent tool: ${tool.name}.`);
        toolNames.add(tool.name);
        tools.push(tool);
      }
    }
    return tools;
  }
}

type AgentToolDefinition<Schema extends z.ZodObject, Result> = {
  name: string;
  title?: string;
  description: string;
  parameters: Schema;
  annotations?: AgentToolAnnotations;
  execute(input: z.infer<Schema>, context: AgentToolExecutionContext): Promise<Result> | Result;
};

/** Preserves schema-derived input types while erasing framework-irrelevant generics at the shared tool boundary. */
export function defineAgentTool<Schema extends z.ZodObject, Result>(
  definition: AgentToolDefinition<Schema, Result>,
): AgentTool {
  return definition as unknown as AgentTool;
}

/** Requires the authenticated actor identity that every shared-data tool must receive from its runtime adapter. */
export function requireAgentActor(context: AgentToolExecutionContext): {
  actorUserId: string;
  chatId: string | null;
} {
  if (!context.actorUserId) throw new Error("Authenticated agent actor is required.");
  return { actorUserId: context.actorUserId, chatId: context.chatId ?? null };
}
