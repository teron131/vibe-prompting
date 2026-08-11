/** Builds native LangChain chat models from the configured model catalogue and credentials. */

import { type ChatOpenAIFields, ChatOpenAI as NativeChatOpenAI } from "@langchain/openai";

import { loadRuntimeConfig, resolveModelPlatform } from "../config.ts";

type ClientConfiguration = NonNullable<ChatOpenAIFields["configuration"]>;

export type ChatModelOptions = Omit<
  ChatOpenAIFields,
  "apiKey" | "configuration" | "model" | "modelName" | "openAIApiKey"
> & {
  configuration?: Omit<ClientConfiguration, "apiKey" | "baseURL">;
  model: string;
};

/** Creates an OpenAI-compatible model while preserving LangChain's complete runnable interface. */
export function createChatModel({
  model,
  configuration,
  ...options
}: ChatModelOptions): NativeChatOpenAI {
  const modelId = model.trim();
  if (!modelId) throw new Error("Model ID must not be empty.");

  const config = loadRuntimeConfig();
  const configuredModel = config.models.find((candidate) => candidate.id === modelId);
  if (!configuredModel) throw new Error(`Model is not configured: ${modelId}.`);

  const platform = resolveModelPlatform(configuredModel, config);
  return new NativeChatOpenAI({
    model: modelId,
    ...options,
    apiKey: platform.apiKey,
    configuration: { ...configuration, baseURL: platform.baseURL },
  });
}
