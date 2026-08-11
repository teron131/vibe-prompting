/** Builds the native LangChain embedding model from configured credentials and model settings. */

import { OpenAIEmbeddings as NativeOpenAIEmbeddings } from "@langchain/openai";

import { loadRuntimeConfig, resolveModelPlatform } from "../config.ts";

type EmbeddingFields = NonNullable<ConstructorParameters<typeof NativeOpenAIEmbeddings>[0]>;
type ClientConfiguration = NonNullable<EmbeddingFields["configuration"]>;

export type EmbeddingModelOptions = Omit<
  EmbeddingFields,
  "apiKey" | "configuration" | "model" | "modelName" | "openAIApiKey"
> & {
  configuration?: Omit<ClientConfiguration, "apiKey" | "baseURL">;
};

/** Creates the configured OpenAI-compatible embedding model with native LangChain operations. */
export function createEmbeddingModel({
  configuration,
  ...options
}: EmbeddingModelOptions = {}): NativeOpenAIEmbeddings {
  const config = loadRuntimeConfig();
  const model = config.embeddingModel;
  const platform = resolveModelPlatform(model, config);
  return new NativeOpenAIEmbeddings({
    model: model.id,
    ...options,
    apiKey: platform.apiKey,
    configuration: { ...configuration, baseURL: platform.baseURL },
  });
}
