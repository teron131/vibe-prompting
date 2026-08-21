/** Builds framework-native Vercel AI SDK agents without coupling them to Target persistence or evaluation contracts. */

import type { LanguageModel, ToolLoopAgentSettings, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";

export type AiSdkAgentOptions = {
  id: string;
  instructions: string;
  maxOutputTokens?: number;
  maxSteps?: number;
  model: LanguageModel;
  providerOptions?: ToolLoopAgentSettings["providerOptions"];
  tools?: ToolSet;
};

export function createAiSdkAgent(options: AiSdkAgentOptions) {
  return new ToolLoopAgent({
    id: options.id,
    instructions: options.instructions,
    maxOutputTokens: options.maxOutputTokens,
    model: options.model,
    providerOptions: options.providerOptions,
    stopWhen: options.maxSteps ? stepCountIs(options.maxSteps) : undefined,
    tools: options.tools,
  });
}
