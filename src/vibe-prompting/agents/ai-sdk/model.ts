/** Adapts configured model providers and shared spend policy to the Vercel AI SDK model contract. */

import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, LanguageModelMiddleware, ToolLoopAgentSettings } from "ai";
import { wrapLanguageModel } from "ai";

import { type SpendCall, startSpendCall } from "../../clients/llm/spend.ts";
import { loadRuntimeConfig, type ModelConfig, resolveModelPlatform } from "../../config/index.ts";

export function createModel(modelId: string): LanguageModel {
  const id = modelId.trim();
  if (!id) throw new Error("Model ID must not be empty.");

  const runtime = loadRuntimeConfig();
  const config = runtime.models.find((candidate) => candidate.id === id);
  if (!config) throw new Error(`Model is not configured: ${id}.`);
  const platform = resolveModelPlatform(config, runtime);
  const middleware: LanguageModelMiddleware[] = [createSpendLimitMiddleware(config)];
  if (platform.id === "gemini") {
    const provider = createGoogleGenerativeAI({
      apiKey: platform.apiKey,
      baseURL: platform.baseURL.replace(/\/openai\/?$/u, ""),
    });
    return wrapLanguageModel({ middleware, model: provider(id) });
  }
  if (id.startsWith("gpt-")) {
    const provider = createOpenAI({ apiKey: platform.apiKey, baseURL: platform.baseURL });
    return wrapLanguageModel({ middleware, model: provider.responses(id) });
  }

  const provider = createOpenAICompatible({
    apiKey: platform.apiKey,
    baseURL: platform.baseURL,
    includeUsage: true,
    name: platform.id,
  });
  return wrapLanguageModel({ middleware, model: provider(id) });
}

/** Projects the shared reasoning setting into the provider-specific options consumed by the configured AI SDK model. */
export function createReasoningProviderOptions(
  modelId: string,
  reasoningEffort: "high" | "low" | "medium" | "xhigh",
): ToolLoopAgentSettings["providerOptions"] {
  const runtime = loadRuntimeConfig();
  const config = runtime.models.find((candidate) => candidate.id === modelId);
  if (!config) throw new Error(`Model is not configured: ${modelId}.`);
  const platform = resolveModelPlatform(config, runtime);
  const effort = reasoningEffort === "xhigh" ? "high" : reasoningEffort;
  if (platform.id === "gemini") {
    return {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: effort,
        },
      } satisfies GoogleLanguageModelOptions,
    };
  }
  if (modelId.startsWith("gpt-")) {
    return { openai: { reasoningEffort: effort, reasoningSummary: "detailed" } };
  }
  return { [platform.id]: { reasoningEffort: effort } };
}

type Usage = {
  inputTokens: { total: number | undefined };
  outputTokens: { total: number | undefined };
};

function createSpendLimitMiddleware(model: ModelConfig): LanguageModelMiddleware {
  const recordUsage = (call: SpendCall, usage: Usage) =>
    call.record({
      inputTokens: usage.inputTokens.total ?? 0,
      outputTokens: usage.outputTokens.total ?? 0,
    });

  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate }) {
      const call = await startSpendCall(model);
      const result = await doGenerate();
      await recordUsage(call, result.usage);
      return result;
    },
    async wrapStream({ doStream }) {
      const call = await startSpendCall(model);
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            async transform(part, controller) {
              if (part.type === "finish") await recordUsage(call, part.usage);
              controller.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}
