/** Builds configured LangChain chat models with shared spend accounting and provider-specific continuation preservation. */

import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import {
  type ChatOpenAIFields,
  ChatOpenAI as NativeChatOpenAI,
  ChatOpenAICompletions as NativeChatOpenAICompletions,
} from "@langchain/openai";

import { loadRuntimeConfig, type ModelConfig, resolveModelPlatform } from "../../config/index.ts";
import { readGeminiThoughtSignature } from "./gemini.ts";
import { type SpendCall, startSpendCall } from "./spend.ts";

type ClientConfiguration = NonNullable<ChatOpenAIFields["configuration"]>;

export type ModelOptions = Omit<
  ChatOpenAIFields,
  "apiKey" | "configuration" | "model" | "modelName" | "openAIApiKey"
> & {
  model: string;
  configuration?: Omit<ClientConfiguration, "apiKey" | "baseURL">;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
};

/** Creates a configured LangChain model and applies the requested provider-native reasoning level. */
export function createModel({
  model,
  configuration,
  reasoningEffort = "medium",
  ...options
}: ModelOptions): NativeChatOpenAI {
  const modelId = model.trim();
  if (!modelId) throw new Error("Model ID must not be empty.");

  const runtime = loadRuntimeConfig();
  const modelConfig =
    runtime.models.find((candidate) => candidate.id === modelId) ??
    (runtime.helperModel.id === modelId ? runtime.helperModel : undefined);
  if (!modelConfig) throw new Error(`Model is not configured: ${modelId}.`);

  const platform = resolveModelPlatform(modelConfig, runtime);
  const fields = {
    model: modelId,
    ...options,
    apiKey: platform.apiKey,
    configuration: { ...configuration, baseURL: platform.baseURL },
    useResponsesApi: modelId.startsWith("gpt-"),
    ...(reasoningEffort &&
      (platform.id === "gemini"
        ? {
            modelKwargs: {
              extra_body: {
                google: {
                  thinking_config: {
                    thinking_level: reasoningEffort === "xhigh" ? "high" : reasoningEffort,
                  },
                },
              },
            },
          }
        : { reasoning: { effort: reasoningEffort } })),
  };
  return new SpendLimitedChatOpenAI({
    ...fields,
    modelConfig,
    ...(platform.id === "gemini" && {
      completions: new GeminiChatOpenAICompletions(fields),
    }),
  });
}

/** Records usage around every LangChain generation while leaving request execution to the native client. */
class SpendLimitedChatOpenAI extends NativeChatOpenAI {
  readonly #modelConfig: ModelConfig;

  constructor(fields: ChatOpenAIFields & { modelConfig: ModelConfig }) {
    const { modelConfig, ...modelFields } = fields;
    super(modelFields);
    this.#modelConfig = modelConfig;
  }

  override async _generate(...args: Parameters<NativeChatOpenAI["_generate"]>) {
    const call = await startSpendCall(this.#modelConfig);
    const result = await super._generate(...args);
    let inputTokens = 0;
    let outputTokens = 0;
    for (const generation of result.generations) {
      if (!AIMessage.isInstance(generation.message)) continue;
      inputTokens += generation.message.usage_metadata?.input_tokens ?? 0;
      outputTokens += generation.message.usage_metadata?.output_tokens ?? 0;
    }
    await call.record({ inputTokens, outputTokens });
    return result;
  }

  override async *_streamChatModelEvents(
    ...args: Parameters<NativeChatOpenAI["_streamChatModelEvents"]>
  ) {
    const call = await startSpendCall(this.#modelConfig);
    let usage: LangChainUsage | undefined;
    for await (const event of super._streamChatModelEvents(...args)) {
      if (event.event === "usage") usage = event.usage;
      if (event.event === "message-finish") {
        usage = event.usage ?? usage;
        await recordLangChainUsage(call, usage);
      }
      yield event;
    }
    await recordLangChainUsage(call, usage);
  }

  override async *_streamResponseChunks(
    ...args: Parameters<NativeChatOpenAI["_streamResponseChunks"]>
  ) {
    const call = await startSpendCall(this.#modelConfig);
    let usage: LangChainUsage | undefined;
    for await (const chunk of super._streamResponseChunks(...args)) {
      if (AIMessageChunk.isInstance(chunk.message) && chunk.message.usage_metadata) {
        usage = chunk.message.usage_metadata;
        await recordLangChainUsage(call, usage);
      }
      yield chunk;
    }
    await recordLangChainUsage(call, usage);
  }
}

type LangChainUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

function recordLangChainUsage(call: SpendCall, usage: LangChainUsage | undefined): Promise<void> {
  return call.record({
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  });
}

class GeminiChatOpenAICompletions extends NativeChatOpenAICompletions {
  override _generate(...args: Parameters<NativeChatOpenAICompletions["_generate"]>) {
    return super._generate(preserveGeminiThoughtSignatures(args[0]), args[1], args[2]);
  }

  override _streamChatModelEvents(
    ...args: Parameters<NativeChatOpenAICompletions["_streamChatModelEvents"]>
  ) {
    return super._streamChatModelEvents(preserveGeminiThoughtSignatures(args[0]), args[1], args[2]);
  }

  override _streamResponseChunks(
    ...args: Parameters<NativeChatOpenAICompletions["_streamResponseChunks"]>
  ) {
    return super._streamResponseChunks(preserveGeminiThoughtSignatures(args[0]), args[1], args[2]);
  }
}

function preserveGeminiThoughtSignatures(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (
      !AIMessage.isInstance(message) ||
      !message.tool_calls?.some(
        (toolCall) =>
          toolCall.id && readGeminiThoughtSignature(message.additional_kwargs, toolCall.id),
      )
    ) {
      return message;
    }

    return new AIMessage({
      additional_kwargs: message.additional_kwargs,
      content: message.content,
      id: message.id,
      invalid_tool_calls: message.invalid_tool_calls,
      name: message.name,
      response_metadata: message.response_metadata,
      tool_calls: [],
      usage_metadata: message.usage_metadata,
    });
  });
}
