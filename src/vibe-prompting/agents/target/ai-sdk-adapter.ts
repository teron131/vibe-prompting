/**
 * Runs AI SDK agents under evaluation without converting their native messages or tool evidence.
 * The adapter records the configured and provider-reported model IDs while leaving agent setup, instructions, tools, stopping policy, and output schema with the supplied AI SDK Agent.
 */

import type {
  AgentCallParameters,
  GenerateTextResult,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  ToolSet,
} from "ai";

type AiSdkGenerateResult<TOOLS extends ToolSet, OUTPUT> = Omit<
  GenerateTextResult<TOOLS, never>,
  "experimental_output" | "output"
> & {
  readonly output: OUTPUT;
};

type AiSdkAgent<CALL_OPTIONS, TOOLS extends ToolSet, OUTPUT> = {
  generate(
    options: AgentCallParameters<CALL_OPTIONS, TOOLS>,
  ): PromiseLike<AiSdkGenerateResult<TOOLS, OUTPUT>>;
};

type ResponseMessage = GenerateTextResult<ToolSet, never>["response"]["messages"][number];

export type AiSdkRunOptions<CALL_OPTIONS, TOOLS extends ToolSet> = Omit<
  AgentCallParameters<CALL_OPTIONS, TOOLS>,
  "messages" | "prompt"
>;

export type AiSdkRunMetadata = {
  finishReason: string;
  provider?: ProviderMetadata;
  responseId: string;
  timestamp: Date;
  usage: LanguageModelUsage;
};

export type AiSdkRunResult = {
  messages: ResponseMessage[];
  model: string;
  requestedModel: string;
  metadata: AiSdkRunMetadata;
};

export type AiSdkStructuredRunResult<OUTPUT> = AiSdkRunResult & {
  output: OUTPUT;
};

type AiSdkAdapterOptions<CALL_OPTIONS, TOOLS extends ToolSet, OUTPUT> = {
  agent: AiSdkAgent<CALL_OPTIONS, TOOLS, OUTPUT>;
  model: string;
};

/**
 * Adapts an AI SDK Agent, including ToolLoopAgent, to repeatable message-based evaluation calls.
 * Use `invokeStructured` only when the supplied agent was configured with an AI SDK output schema.
 */
export class AiSdkAdapter<CALL_OPTIONS = never, TOOLS extends ToolSet = ToolSet, OUTPUT = never> {
  readonly agent: AiSdkAgent<CALL_OPTIONS, TOOLS, OUTPUT>;
  readonly model: string;

  constructor({ agent, model }: AiSdkAdapterOptions<CALL_OPTIONS, TOOLS, OUTPUT>) {
    const modelId = model.trim();
    if (!modelId) throw new Error("Model ID must not be empty.");

    this.agent = agent;
    this.model = modelId;
  }

  /** Runs the agent and returns every generated assistant and tool message. */
  async invoke(
    messages: ModelMessage[],
    options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>,
  ): Promise<AiSdkRunResult> {
    const result = await this.generate(messages, options);
    return this.toRunResult(result);
  }

  /** Runs an output-configured agent and returns its validated value with the native messages. */
  async invokeStructured(
    messages: ModelMessage[],
    options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>,
  ): Promise<AiSdkStructuredRunResult<OUTPUT>> {
    const result = await this.generate(messages, options);
    return {
      ...this.toRunResult(result),
      output: result.output,
    };
  }

  private generate(messages: ModelMessage[], options?: AiSdkRunOptions<CALL_OPTIONS, TOOLS>) {
    return this.agent.generate({
      ...options,
      messages,
    } as AgentCallParameters<CALL_OPTIONS, TOOLS>);
  }

  private toRunResult(result: AiSdkGenerateResult<TOOLS, OUTPUT>): AiSdkRunResult {
    return {
      messages: result.response.messages,
      model: result.response.modelId,
      requestedModel: this.model,
      metadata: {
        finishReason: result.finishReason,
        ...(result.providerMetadata && { provider: result.providerMetadata }),
        responseId: result.response.id,
        timestamp: result.response.timestamp,
        usage: result.totalUsage,
      },
    };
  }
}
