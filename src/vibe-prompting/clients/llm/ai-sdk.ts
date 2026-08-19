/** Builds configured Vercel AI SDK models with GPT-only Responses routing and deployment-wide spend enforcement. */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";

import { loadRuntimeConfig, type ModelConfig, resolveModelPlatform } from "../../config/index.ts";
import { type SpendCall, startSpendCall } from "./spend.ts";

export function createModel(modelId: string): LanguageModel {
  const id = modelId.trim();
  if (!id) throw new Error("Model ID must not be empty.");

  const runtime = loadRuntimeConfig();
  const config = runtime.models.find((candidate) => candidate.id === id);
  if (!config) throw new Error(`Model is not configured: ${id}.`);
  const platform = resolveModelPlatform(config, runtime);
  const middleware = createSpendLimitMiddleware(config);
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
