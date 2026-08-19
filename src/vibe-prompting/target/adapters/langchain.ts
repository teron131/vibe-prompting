/**
 * Adapts LangChain agents to the Target contract through their native message-state contract.
 * The adapter exposes only native messages and the configured model ID without translating message history or leaking runtime metadata.
 */

import {
  type BaseMessage,
  type BaseMessageLike,
  coerceMessageLikeToMessage,
} from "@langchain/core/messages";
import type { RunnableConfig, RunnableInterface } from "@langchain/core/runnables";

export type LangChainInput = string | BaseMessageLike[];

export type LangChainAgentInput = {
  messages: BaseMessage[];
};

export type LangChainAgentOutput<OUTPUT = unknown> = {
  messages: BaseMessage[];
  structuredResponse?: OUTPUT;
};

export type LangChainRunResult = {
  messages: BaseMessage[];
  model: string;
};

export type LangChainStructuredRunResult<OUTPUT> = LangChainRunResult & {
  output: OUTPUT;
};

type LangChainAdapterOptions<OUTPUT> = {
  model: string;
  agent: RunnableInterface<LangChainAgentInput, LangChainAgentOutput<OUTPUT>>;
};

/**
 * Adapts a LangChain agent or graph whose input and output state contain native BaseMessage arrays.
 * Runtime configuration is passed directly to `invoke`; structured output remains owned by the agent.
 */
export class LangChainAdapter<OUTPUT = unknown> {
  readonly model: string;
  readonly agent: RunnableInterface<LangChainAgentInput, LangChainAgentOutput<OUTPUT>>;

  constructor({ model, agent }: LangChainAdapterOptions<OUTPUT>) {
    const modelId = model.trim();
    if (!modelId) throw new Error("Model ID must not be empty.");

    this.model = modelId;
    this.agent = agent;
  }

  async invoke(
    input: LangChainInput,
    options?: Partial<RunnableConfig>,
  ): Promise<LangChainRunResult> {
    const messages = normalizeMessages(input);
    const result = await this.agent.invoke({ messages }, options);
    return this.toRunResult(result.messages);
  }

  async invokeStructured(
    input: LangChainInput,
    options?: Partial<RunnableConfig>,
  ): Promise<LangChainStructuredRunResult<OUTPUT>> {
    const messages = normalizeMessages(input);
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
    return {
      messages,
      model: this.model,
    };
  }
}

function normalizeMessages(input: LangChainInput): BaseMessage[] {
  const messages = typeof input === "string" ? [input] : input;
  return messages.map((message) => coerceMessageLikeToMessage(message));
}
