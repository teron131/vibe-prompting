/** Defines the framework-neutral function-tool contract that agent capabilities implement and runtime adapters translate. */

import type { z } from "zod";

export type AgentToolExecutionContext = {
  signal?: AbortSignal;
};

export type AgentTool = {
  description: string;
  execute(input: unknown, context: AgentToolExecutionContext): Promise<unknown> | unknown;
  name: string;
  parameters: z.ZodObject;
};

type AgentToolDefinition<Schema extends z.ZodObject, Result> = {
  description: string;
  execute(input: z.infer<Schema>, context: AgentToolExecutionContext): Promise<Result> | Result;
  name: string;
  parameters: Schema;
};

/** Preserves schema-derived input types while erasing framework-irrelevant generics at the shared tool boundary. */
export function defineAgentTool<Schema extends z.ZodObject, Result>(
  definition: AgentToolDefinition<Schema, Result>,
): AgentTool {
  return definition as unknown as AgentTool;
}
