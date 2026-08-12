/**
 * Runs LangChain agents under evaluation through their native message-state contract.
 * The adapter targets the standard agent result shape and does not translate LangChain messages, tool calls, or tool results into an invented cross-framework representation.
 */

import { AIMessage, type BaseMessage, type UsageMetadata } from "@langchain/core/messages";
import type { RunnableConfig, RunnableInterface } from "@langchain/core/runnables";

export type LangChainAgentInput = {
  messages: BaseMessage[];
};

export type LangChainAgentOutput<OUTPUT = unknown> = {
  messages: BaseMessage[];
  structuredResponse?: OUTPUT;
};

export type LangChainRunMetadata = {
  response?: Record<string, unknown>;
  usage?: UsageMetadata;
};

export type LangChainRunResult = {
  messages: BaseMessage[];
  model: string;
  requestedModel: string;
  metadata?: LangChainRunMetadata;
};

export type LangChainStructuredRunResult<OUTPUT> = LangChainRunResult & {
  output: OUTPUT;
};

type LangChainAdapterOptions<OUTPUT> = {
  agent: RunnableInterface<LangChainAgentInput, LangChainAgentOutput<OUTPUT>>;
  model: string;
};

/**
 * Adapts a LangChain agent or graph whose input and output state contain native BaseMessage arrays.
 * Runtime configuration is passed directly to `invoke`; structured output remains owned by the agent.
 */
export class LangChainAdapter<OUTPUT = unknown> {
  readonly agent: RunnableInterface<LangChainAgentInput, LangChainAgentOutput<OUTPUT>>;
  readonly model: string;

  constructor({ agent, model }: LangChainAdapterOptions<OUTPUT>) {
    const modelId = model.trim();
    if (!modelId) throw new Error("Model ID must not be empty.");

    this.agent = agent;
    this.model = modelId;
  }

  /** Runs the agent and returns its complete native message state. */
  async invoke(
    messages: BaseMessage[],
    options?: Partial<RunnableConfig>,
  ): Promise<LangChainRunResult> {
    const result = await this.agent.invoke({ messages }, options);
    return this.toRunResult(result.messages);
  }

  /** Runs a structured-response agent and requires the validated result to be present. */
  async invokeStructured(
    messages: BaseMessage[],
    options?: Partial<RunnableConfig>,
  ): Promise<LangChainStructuredRunResult<OUTPUT>> {
    const result = await this.agent.invoke({ messages }, options);
    if (result.structuredResponse === undefined) {
      throw new Error("LangChain agent did not return a structured response.");
    }

    return {
      ...this.toRunResult(result.messages),
      output: result.structuredResponse,
    };
  }

  private toRunResult(messages: BaseMessage[]): LangChainRunResult {
    const finalMessage = messages.findLast((message) => AIMessage.isInstance(message));
    const response = finalMessage?.response_metadata;
    const model = readModelId(response) ?? this.model;
    const usage = finalMessage?.usage_metadata;
    const metadata = {
      ...(response && Object.keys(response).length > 0 && { response }),
      ...(usage && { usage }),
    };

    return {
      messages,
      model,
      requestedModel: this.model,
      ...(Object.keys(metadata).length > 0 && { metadata }),
    };
  }
}

function readModelId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;

  for (const key of ["model", "modelId", "model_name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}
