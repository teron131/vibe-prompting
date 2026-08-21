/** Publishes the opaque Target contract, framework adapters, vanilla AI SDK runtime, and database-backed profiles as a peer application capability. */

export { type Target, targetSchema } from "./api.ts";
export {
  AiSdkAdapter,
  type AiSdkInput,
  type AiSdkRunOptions,
  type AiSdkRunResult,
  type AiSdkTargetRun,
  type AiSdkTargetRuntime,
  createAiSdkTarget,
  createAiSdkTargetRuntime,
  sanitizeAiSdkHistory,
  type AiSdkStreamRunResult,
  type AiSdkStructuredRunResult,
} from "./adapters/ai-sdk.ts";
export {
  LangChainAdapter,
  type LangChainAgentInput,
  type LangChainAgentOutput,
  type LangChainInput,
  type LangChainRunResult,
  type LangChainStructuredRunResult,
} from "./adapters/langchain.ts";
export {
  TargetProfileNotFoundError,
  TargetSystem,
  type PinnedTarget,
  type TargetProfile,
} from "./system.ts";
export { targetConfigurationSchema, type TargetConfiguration } from "./configuration.ts";
