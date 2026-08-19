/** Restores provider-emitted reasoning summaries that the Agents Chat Completions adapter does not recognize. */

import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRetryAdviceRequest,
  StreamEvent,
} from "@openai/agents";

type ResponseOutput = Extract<StreamEvent, { type: "response_done" }>["response"]["output"];

/** Normalizes reasoning variants used by Chat Completions providers into the Agents model contract. */
export function normalizeChatCompletionsReasoning(provider: ModelProvider): ModelProvider {
  return {
    async getModel(modelName) {
      return new ChatCompletionsReasoningModel(await provider.getModel(modelName));
    },
  };
}

class ChatCompletionsReasoningModel implements Model {
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
    let pendingThoughtText = "";
    let summary = "";
    let visibleText = "";

    for await (const event of this.model.getStreamedResponse(request)) {
      const reasoning = readReasoningContent(event);
      if (reasoning) {
        summary += reasoning.text;
        if (reasoning.emittedAsText) pendingThoughtText += reasoning.text;
      }
      if (event.type === "output_text_delta") {
        if (pendingThoughtText.startsWith(event.delta)) {
          pendingThoughtText = pendingThoughtText.slice(event.delta.length);
          continue;
        }
        let delta = event.delta;
        if (pendingThoughtText && event.delta.startsWith(pendingThoughtText)) {
          delta = event.delta.slice(pendingThoughtText.length);
          pendingThoughtText = "";
        }
        pendingThoughtText = "";
        delta = delta.replace(/^\s*<\/?thought>\s*/u, "");
        if (!delta) continue;
        visibleText += delta;
        yield delta === event.delta ? event : { ...event, delta };
        continue;
      }
      if (event.type !== "response_done" || !summary) {
        yield event;
        if (event.type === "response_done") {
          pendingThoughtText = "";
          visibleText = "";
        }
        continue;
      }

      const output = replaceOutputText(event.response.output, visibleText);
      yield {
        ...event,
        response: {
          ...event.response,
          output: hasReasoning(output)
            ? output
            : [
                {
                  content: [],
                  rawContent: [{ text: summary, type: "reasoning_text" }],
                  type: "reasoning",
                },
                ...output,
              ],
        },
      };
      pendingThoughtText = "";
      summary = "";
      visibleText = "";
    }
  }
}

function readReasoningContent(
  event: StreamEvent,
): { emittedAsText: boolean; text: string } | undefined {
  if (event.type !== "model" || !isRecord(event.event)) return undefined;
  const choices = event.event.choices;
  if (!Array.isArray(choices)) return undefined;
  const choice = choices.find(
    (candidate) => isRecord(candidate) && (candidate.index === 0 || candidate.index === undefined),
  );
  if (!isRecord(choice) || !isRecord(choice.delta)) return undefined;

  const reasoningContent = choice.delta.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent) {
    return { emittedAsText: false, text: reasoningContent };
  }
  const content = choice.delta.content;
  const extraContent = choice.delta.extra_content;
  if (
    typeof content === "string" &&
    content &&
    isRecord(extraContent) &&
    isRecord(extraContent.google) &&
    extraContent.google.thought === true
  ) {
    return { emittedAsText: true, text: content };
  }
  return undefined;
}

function hasReasoning(output: ResponseOutput): boolean {
  return output.some((item) => item.type === "reasoning");
}

function replaceOutputText(output: ResponseOutput, text: string): ResponseOutput {
  return output.map((item) => {
    if (item.type !== "message" || item.role !== "assistant") return item;
    return {
      ...item,
      content: item.content.map((content) =>
        content.type === "output_text" ? { ...content, text } : content,
      ),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
