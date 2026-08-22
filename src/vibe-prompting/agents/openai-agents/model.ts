/** Adapts configured model providers and shared spend policy to the OpenAI Agents SDK model contract. */

import {
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelRetryAdviceRequest,
  OpenAIProvider,
  type StreamEvent,
} from "@openai/agents";

import { startSpendCall } from "../../clients/llm/spend.ts";
import { loadRuntimeConfig, type ModelConfig, resolveModelPlatform } from "../../config/index.ts";
import { preserveGeminiToolCallSignatures } from "./gemini.ts";
import { normalizeChatCompletionsReasoning } from "./reasoning.ts";

export function createModel(modelId: string): {
  config: ModelConfig;
  provider: ModelProvider;
} {
  const id = modelId.trim();
  if (!id) throw new Error("Model ID must not be empty.");

  const runtime = loadRuntimeConfig();
  const config = runtime.models.find((candidate) => candidate.id === id);
  if (!config) throw new Error(`Model is not configured: ${id}.`);

  const platform = resolveModelPlatform(config, runtime);
  const usesResponses = config.id.startsWith("gpt-");
  const baseProvider = new OpenAIProvider({
    apiKey: platform.apiKey,
    baseURL: platform.baseURL,
    strictFeatureValidation: true,
    useResponses: usesResponses,
  });
  const reasoningProvider = usesResponses
    ? baseProvider
    : normalizeChatCompletionsReasoning(baseProvider);
  const provider =
    platform.id === "gemini"
      ? preserveGeminiToolCallSignatures(reasoningProvider)
      : reasoningProvider;
  return {
    config,
    provider: {
      async getModel(modelName) {
        return new SpendLimitedModel(await provider.getModel(modelName), config);
      },
    },
  };
}

class SpendLimitedModel implements Model {
  readonly #config: ModelConfig;
  readonly #model: Model;

  constructor(model: Model, config: ModelConfig) {
    this.#model = model;
    this.#config = config;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const call = await startSpendCall(this.#config);
    try {
      const response = await this.#model.getResponse(request);
      await call.record(response.usage);
      return response;
    } finally {
      call.release();
    }
  }

  getRetryAdvice(args: ModelRetryAdviceRequest) {
    return this.#model.getRetryAdvice?.(args);
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const call = await startSpendCall(this.#config);
    try {
      for await (const event of this.#model.getStreamedResponse(request)) {
        if (event.type === "response_done") await call.record(event.response.usage);
        yield event;
      }
    } finally {
      call.release();
    }
  }
}
