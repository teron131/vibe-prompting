/** Preserves Gemini continuation signatures across OpenAI-compatible framework clients and Target adapters. */

import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRetryAdviceRequest,
  StreamEvent,
} from "@openai/agents";
import type { LanguageModelMiddleware } from "ai";

/** Adapts Gemini metadata to the AI SDK OpenAI-compatible encoder's Google continuation contract without changing provider identity. */
export function preserveAiSdkGeminiToolCallSignatures(): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => ({
      ...params,
      prompt: params.prompt.map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              content: message.content.map((part) => {
                if (part.type !== "tool-call") return part;
                const thoughtSignature = part.providerOptions?.gemini?.thoughtSignature;
                return typeof thoughtSignature === "string" && thoughtSignature
                  ? {
                      ...part,
                      providerOptions: {
                        ...part.providerOptions,
                        google: {
                          ...part.providerOptions?.google,
                          thoughtSignature,
                        },
                      },
                    }
                  : part;
              }),
            }
          : message,
      ),
    }),
  };
}

/** Wraps an Agents SDK provider because its streaming Chat Completions converter drops Gemini's signed tool-call metadata. */
export function preserveGeminiToolCallSignatures(provider: ModelProvider): ModelProvider {
  return {
    async getModel(modelName) {
      return new GeminiToolCallModel(await provider.getModel(modelName));
    },
  };
}

export function readGeminiThoughtSignature(
  additionalKwargs: Record<string, unknown>,
  toolCallId: string,
): string | undefined {
  const rawToolCalls = additionalKwargs["tool_calls"];
  if (!Array.isArray(rawToolCalls)) return undefined;

  const rawToolCall: unknown = rawToolCalls.find(
    (candidate) => isRecord(candidate) && candidate.id === toolCallId,
  );
  if (!isRecord(rawToolCall)) return undefined;
  return readThoughtSignature(rawToolCall.extra_content);
}

class GeminiToolCallModel implements Model {
  private readonly model: Model;

  constructor(model: Model) {
    this.model = model;
  }

  getResponse(request: ModelRequest): Promise<ModelResponse> {
    return this.model.getResponse(request);
  }

  getRetryAdvice(args: ModelRetryAdviceRequest) {
    return this.model.getRetryAdvice?.(args);
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const signaturesByCallId = new Map<string, string>();
    const signaturesByIndex = new Map<number, string>();

    for await (const event of this.model.getStreamedResponse(request)) {
      captureStreamSignatures(event, signaturesByCallId, signaturesByIndex);
      if (event.type !== "response_done") {
        yield event;
        continue;
      }

      let functionIndex = 0;
      yield {
        ...event,
        response: {
          ...event.response,
          output: event.response.output.map((item) => {
            if (item.type !== "function_call") return item;
            const signature =
              signaturesByCallId.get(item.callId) ?? signaturesByIndex.get(functionIndex);
            functionIndex += 1;
            if (!signature) return item;
            return {
              ...item,
              providerData: {
                ...item.providerData,
                extra_content: { google: { thought_signature: signature } },
              },
            };
          }),
        },
      };
    }
  }
}

function captureStreamSignatures(
  event: StreamEvent,
  byCallId: Map<string, string>,
  byIndex: Map<number, string>,
): void {
  if (event.type !== "model" || !isRecord(event.event)) return;
  const choices = event.event.choices;
  if (!Array.isArray(choices)) return;

  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.delta)) continue;
    const toolCalls = choice.delta.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) continue;
      const signature = readThoughtSignature(toolCall.extra_content);
      if (!signature) continue;
      if (typeof toolCall.id === "string" && toolCall.id) byCallId.set(toolCall.id, signature);
      if (typeof toolCall.index === "number") byIndex.set(toolCall.index, signature);
    }
  }
}

function readThoughtSignature(extraContent: unknown): string | undefined {
  if (!isRecord(extraContent)) return undefined;
  const google = extraContent.google;
  if (!isRecord(google)) return undefined;
  const thoughtSignature = google.thought_signature;
  return typeof thoughtSignature === "string" && thoughtSignature ? thoughtSignature : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
