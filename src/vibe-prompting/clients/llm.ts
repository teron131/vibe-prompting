/** Builds configured OpenAI-compatible LangChain models and preserves provider continuation data that generic serialization would lose. */

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  type ChatOpenAIFields,
  ChatOpenAI as NativeChatOpenAI,
  ChatOpenAICompletions as NativeChatOpenAICompletions,
} from "@langchain/openai";

import { loadRuntimeConfig, resolveModelPlatform } from "../config.ts";
import { readGeminiThoughtSignature } from "./gemini-tool-calls.ts";

type ClientConfiguration = NonNullable<ChatOpenAIFields["configuration"]>;

export type ChatModelOptions = Omit<
  ChatOpenAIFields,
  "apiKey" | "configuration" | "model" | "modelName" | "openAIApiKey"
> & {
  model: string;
  configuration?: Omit<ClientConfiguration, "apiKey" | "baseURL">;
};

export function createChatModel({
  model,
  configuration,
  ...options
}: ChatModelOptions): NativeChatOpenAI {
  const modelId = model.trim();
  if (!modelId) throw new Error("Model ID must not be empty.");

  const config = loadRuntimeConfig();
  const configuredModel =
    config.models.find((candidate) => candidate.id === modelId) ??
    (config.metadataModel.id === modelId ? config.metadataModel : undefined);
  if (!configuredModel) throw new Error(`Model is not configured: ${modelId}.`);

  const platform = resolveModelPlatform(configuredModel, config);
  const fields = {
    model: modelId,
    ...options,
    apiKey: platform.apiKey,
    configuration: { ...configuration, baseURL: platform.baseURL },
  };
  return new NativeChatOpenAI({
    ...fields,
    ...(platform.id === "gemini" && {
      completions: new GeminiChatOpenAICompletions(fields),
    }),
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
