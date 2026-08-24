/**
 * Adapts framework-native AI SDK agents to the Target contract while preserving native messages and translating LangChain-compatible text and tool histories at the input boundary.
 * This boundary also composes the default Target runtime while agent construction remains independent under agents/ai-sdk.
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
  type AgentStreamParameters,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  modelMessageSchema,
  type TextStreamPart,
  type ToolLoopAgentSettings,
  type ToolSet,
} from "ai";

import { createAiSdkAgent } from "../../agents/ai-sdk/runtime.ts";
import { readGeminiThoughtSignature } from "../../clients/llm/gemini.ts";
import type { TargetActivityPart, TargetRuntimeEvent } from "../activity.ts";
import type { Target } from "../api.ts";
import type { TargetConfiguration } from "../configuration.ts";

type ResponseMessage = Extract<ModelMessage, { role: "assistant" | "tool" }>;

type AiSdkGenerateResult<OUTPUT> = {
  readonly output: OUTPUT;
  readonly responseMessages: ResponseMessage[];
};

type AiSdkStreamResult<TOOLS extends ToolSet> = {
  readonly stream: AsyncIterable<TextStreamPart<TOOLS>>;
  readonly responseMessages: PromiseLike<ResponseMessage[]>;
  readonly totalUsage: PromiseLike<LanguageModelUsage>;
};

type AiSdkAgent<CALL_OPTIONS, TOOLS extends ToolSet, OUTPUT> = {
  generate(
    options: AgentCallParameters<CALL_OPTIONS, TOOLS>,
  ): PromiseLike<AiSdkGenerateResult<OUTPUT>>;
  stream(
    options: AgentStreamParameters<CALL_OPTIONS, TOOLS>,
  ): PromiseLike<AiSdkStreamResult<TOOLS>>;
};

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

export type AiSdkStreamRunResult = {
  activity: TargetActivityPart[];
  messages: ModelMessage[];
  output: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export type AiSdkTargetRun = {
  activity: TargetActivityPart[];
  output: string;
  responseMessages: ModelMessage[];
  usage: AiSdkStreamRunResult["usage"];
};

export type AiSdkTargetRuntime = {
  run(input: {
    messages: ModelMessage[];
    onEvent?(event: TargetRuntimeEvent): void;
    signal?: AbortSignal;
  }): Promise<AiSdkTargetRun>;
  target: Target<string, string>;
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

  async stream(
    input: AiSdkInput,
    options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS> & {
      onEvent?(event: TargetRuntimeEvent): void;
    },
  ): Promise<AiSdkStreamRunResult> {
    const { onEvent, ...runOptions } = options ?? {};
    const prompt =
      typeof input === "string" ? { prompt: input } : { messages: normalizeMessages(input) };
    const result = await this.agent.stream({
      ...runOptions,
      ...prompt,
    } as AgentStreamParameters<CALL_OPTIONS, TOOLS>);
    const activity: TargetActivityPart[] = [];
    const tools = new Map<string, number>();
    let reasoning = "";
    let output = "";
    const finishReasoning = () => {
      const summary = reasoning.trim();
      reasoning = "";
      if (!summary) return;
      const part = { summary, type: "reasoning" as const };
      activity.push(part);
      onEvent?.(part);
    };

    for await (const event of result.stream) {
      if (event.type === "reasoning-start") {
        finishReasoning();
        onEvent?.({ type: "reasoning-start" });
      } else if (event.type === "reasoning-delta") {
        reasoning += event.text;
        onEvent?.({ delta: event.text, type: "reasoning-delta" });
      } else if (event.type === "reasoning-end") {
        finishReasoning();
      } else if (event.type === "text-delta") {
        output += event.text;
        onEvent?.({ delta: event.text, type: "text-delta" });
      } else if (event.type === "tool-call") {
        const part: TargetActivityPart = {
          callId: event.toolCallId,
          input: normalizeActivityValue(event.input),
          name: event.toolName,
          state: "running",
          type: "tool",
        };
        tools.set(event.toolCallId, activity.length);
        activity.push(part);
        onEvent?.(part);
      } else if (event.type === "tool-result" || event.type === "tool-error") {
        const existingIndex = tools.get(event.toolCallId);
        const part: TargetActivityPart = {
          callId: event.toolCallId,
          input: normalizeActivityValue(event.input),
          name: event.toolName,
          output: normalizeActivityValue(event.type === "tool-result" ? event.output : event.error),
          state: event.type === "tool-result" ? "completed" : "failed",
          type: "tool",
        };
        if (existingIndex === undefined) {
          tools.set(event.toolCallId, activity.length);
          activity.push(part);
        } else {
          activity[existingIndex] = part;
        }
        onEvent?.(part);
      } else if (event.type === "tool-output-denied") {
        const existingIndex = tools.get(event.toolCallId);
        const existing = existingIndex === undefined ? undefined : activity[existingIndex];
        const part: TargetActivityPart = {
          callId: event.toolCallId,
          ...(existing?.type === "tool" && existing.input !== undefined
            ? { input: existing.input }
            : {}),
          name: event.toolName,
          output: "Tool execution was denied.",
          state: "failed",
          type: "tool",
        };
        if (existingIndex === undefined) activity.push(part);
        else activity[existingIndex] = part;
        onEvent?.(part);
      } else if (event.type === "error") {
        throw event.error;
      }
    }

    finishReasoning();
    const [responseMessages, usage] = await Promise.all([
      result.responseMessages,
      result.totalUsage,
    ]);
    return {
      activity,
      messages: sanitizeAiSdkHistory(responseMessages as ModelMessage[]),
      output,
      usage: projectUsage(usage),
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

  private toRunResult(result: AiSdkGenerateResult<OUTPUT>): AiSdkRunResult {
    return {
      messages: result.responseMessages,
      model: this.model,
    };
  }
}

export function createAiSdkTarget(input: {
  configuration: TargetConfiguration;
  instructions: string;
  model: LanguageModel;
  modelId: string;
  profileId: string;
  providerOptions?: ToolLoopAgentSettings["providerOptions"];
  tools?: ToolSet;
}): Target<string, string> {
  return createAiSdkTargetRuntime(input).target;
}

/** Composes a framework-native AI SDK agent with the Target adapter used by evaluation and durable runs. */
export function createAiSdkTargetRuntime(input: {
  configuration: TargetConfiguration;
  instructions: string;
  model: LanguageModel;
  modelId: string;
  profileId: string;
  providerOptions?: ToolLoopAgentSettings["providerOptions"];
  tools?: ToolSet;
}): AiSdkTargetRuntime {
  const agent = createAiSdkAgent({
    id: input.profileId,
    instructions: input.instructions,
    maxOutputTokens: input.configuration.maxOutputTokens,
    maxSteps: input.configuration.maxSteps,
    model: input.model,
    prepareStep: ({ messages }) => ({ messages: sanitizeAiSdkHistory(messages) }),
    providerOptions: input.providerOptions,
    tools: input.tools,
  });
  const adapter = new AiSdkAdapter({ agent, model: input.modelId });
  return {
    async run({ messages, onEvent, signal }) {
      const result = await adapter.stream(messages, {
        abortSignal: signal,
        onEvent,
      });
      return {
        activity: result.activity,
        output: result.output,
        responseMessages: result.messages,
        usage: result.usage,
      };
    },
    target: {
      model: input.modelId,
      async invoke(message) {
        const result = await agent.generate({ prompt: message });
        return result.text;
      },
    },
  };
}

function normalizeActivityValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Error) return value.message;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

/** Removes provider-owned response references and hidden reasoning parts so persisted history can be replayed without remote item storage. */
export function sanitizeAiSdkHistory(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => sanitizeHistoryValue(message) as ModelMessage);
}

function sanitizeHistoryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          !(item && typeof item === "object" && "type" in item && item.type === "reasoning"),
      )
      .map(sanitizeHistoryValue);
  }
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "providerOptions" && item && typeof item === "object" && !Array.isArray(item)) {
      const { openai: _ephemeralOpenAiReferences, ...portableOptions } = item as Record<
        string,
        unknown
      >;
      if (Object.keys(portableOptions).length)
        sanitized[key] = sanitizeHistoryValue(portableOptions);
      continue;
    }
    sanitized[key] = sanitizeHistoryValue(item);
  }
  return sanitized;
}

function projectUsage(usage: LanguageModelUsage): AiSdkStreamRunResult["usage"] {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
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
