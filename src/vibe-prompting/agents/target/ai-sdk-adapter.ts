/**
 * Runs AI SDK agents under evaluation while preserving native messages and translating LangChain-compatible text and tool histories at the input boundary.
 * The adapter exposes only generated messages and the configured model ID while leaving provider metadata, agent setup, tools, stopping policy, and output schema with the supplied AI SDK Agent.
 */

import {
  AIMessage,
  type BaseMessage,
  type BaseMessageLike,
  coerceMessageLikeToMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  type AgentCallParameters,
  type GenerateTextResult,
  type ModelMessage,
  modelMessageSchema,
  type ToolSet,
} from "ai";

import { readGeminiThoughtSignature } from "../../clients/gemini-tool-calls.ts";

type AiSdkGenerateResult<TOOLS extends ToolSet, OUTPUT> = Omit<
  GenerateTextResult<TOOLS, never>,
  "experimental_output" | "output"
> & {
  readonly output: OUTPUT;
};

type AiSdkAgent<CALL_OPTIONS, TOOLS extends ToolSet, OUTPUT> = {
  generate(
    options: AgentCallParameters<CALL_OPTIONS, TOOLS>,
  ): PromiseLike<AiSdkGenerateResult<TOOLS, OUTPUT>>;
};

type ResponseMessage = GenerateTextResult<ToolSet, never>["response"]["messages"][number];

export type AiSdkRunOptions<CALL_OPTIONS, TOOLS extends ToolSet> = Omit<
  AgentCallParameters<CALL_OPTIONS, TOOLS>,
  "messages" | "prompt"
>;

export type AiSdkRunResult = {
  messages: ResponseMessage[];
  model: string;
};

export type AiSdkInput = string | ModelMessage[] | BaseMessageLike[];

export type AiSdkStructuredRunResult<OUTPUT> = AiSdkRunResult & {
  output: OUTPUT;
};

type AiSdkAdapterOptions<CALL_OPTIONS, TOOLS extends ToolSet, OUTPUT> = {
  model: string;
  agent: AiSdkAgent<CALL_OPTIONS, TOOLS, OUTPUT>;
};

/**
 * Adapts an AI SDK Agent, including ToolLoopAgent, to repeatable message-based evaluation calls.
 * Use `invokeStructured` only when the supplied agent was configured with an AI SDK output schema.
 */
export class AiSdkAdapter<CALL_OPTIONS = never, TOOLS extends ToolSet = ToolSet, OUTPUT = never> {
  readonly model: string;
  readonly agent: AiSdkAgent<CALL_OPTIONS, TOOLS, OUTPUT>;

  constructor({ model, agent }: AiSdkAdapterOptions<CALL_OPTIONS, TOOLS, OUTPUT>) {
    const modelId = model.trim();
    if (!modelId) throw new Error("Model ID must not be empty.");

    this.model = modelId;
    this.agent = agent;
  }

  async invoke(
    input: AiSdkInput,
    options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>,
  ): Promise<AiSdkRunResult> {
    const result = await this.generate(input, options);
    return this.toRunResult(result);
  }

  async invokeStructured(
    input: AiSdkInput,
    options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>,
  ): Promise<AiSdkStructuredRunResult<OUTPUT>> {
    const result = await this.generate(input, options);
    return {
      ...this.toRunResult(result),
      output: result.output,
    };
  }

  private generate(input: AiSdkInput, options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>) {
    const prompt =
      typeof input === "string" ? { prompt: input } : { messages: normalizeMessages(input) };
    return this.agent.generate({
      ...options,
      ...prompt,
    } as AgentCallParameters<CALL_OPTIONS, TOOLS>);
  }

  private toRunResult(result: AiSdkGenerateResult<TOOLS, OUTPUT>): AiSdkRunResult {
    return {
      messages: result.response.messages,
      model: this.model,
    };
  }
}

function normalizeMessages(messages: ModelMessage[] | BaseMessageLike[]): ModelMessage[] {
  if (messages.every(isNativeAiSdkMessage)) {
    return messages as ModelMessage[];
  }

  const toolNames = new Map<string, string>();
  return messages.map((message) =>
    convertLangChainMessage(coerceMessageLikeToMessage(message as BaseMessageLike), toolNames),
  );
}

function isNativeAiSdkMessage(message: ModelMessage | BaseMessageLike): message is ModelMessage {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return false;
  if (!modelMessageSchema.safeParse(message).success) return false;
  return Object.keys(message).every((key) => ["content", "providerOptions", "role"].includes(key));
}

function convertLangChainMessage(
  message: BaseMessage,
  toolNames: Map<string, string>,
): ModelMessage {
  if (typeof message.content !== "string") {
    throw new Error(
      "AI SDK conversion supports only text LangChain messages; pass native AI SDK messages for richer content.",
    );
  }

  switch (message.type) {
    case "ai": {
      if (!AIMessage.isInstance(message) || !message.tool_calls?.length) {
        return { role: "assistant", content: message.content };
      }

      const toolCalls = message.tool_calls.map((toolCall) => {
        if (!toolCall.id)
          throw new Error("A LangChain tool call must have an ID for AI SDK conversion.");
        toolNames.set(toolCall.id, toolCall.name);
        const thoughtSignature = readGeminiThoughtSignature(message.additional_kwargs, toolCall.id);
        return {
          type: "tool-call" as const,
          input: toolCall.args,
          ...(thoughtSignature && { providerOptions: { google: { thoughtSignature } } }),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        };
      });
      const content = [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...toolCalls,
      ];
      return { role: "assistant", content };
    }
    case "human":
      return { role: "user", content: message.content };
    case "system":
      if (message.additional_kwargs.__openai_role__ === "developer") {
        throw new Error(
          "AI SDK conversion cannot preserve the LangChain developer role; use a native AI SDK system message only when changing its authority is intentional.",
        );
      }
      return { role: "system", content: message.content };
    case "tool": {
      if (!ToolMessage.isInstance(message)) throw new Error("Invalid LangChain tool message.");
      const toolName = message.name ?? toolNames.get(message.tool_call_id);
      if (!toolName) {
        throw new Error(
          "A LangChain tool message needs a name or a preceding named tool call for AI SDK conversion.",
        );
      }
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            output:
              message.status === "error"
                ? { type: "error-text", value: message.content }
                : { type: "text", value: message.content },
            toolCallId: message.tool_call_id,
            toolName,
          },
        ],
      };
    }
    default:
      throw new Error(
        `AI SDK conversion does not support the LangChain message type: ${message.type}.`,
      );
  }
}
