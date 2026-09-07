/** Publishes the opaque Target contract, framework adapters, vanilla AI SDK runtime, and database-backed profiles as a peer application capability. */

export {
  type Target,
  targetSchema,
  targetConfigurationSchema,
  type TargetConfiguration,
  type TargetProfile,
  type PinnedTargetDefinition,
  type TargetPinInput,
} from "./schemas.ts";
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
export { TargetSystem } from "./system.ts";
export { TargetProfileNotFoundError } from "./profiles.ts";
export type { PinnedTarget } from "./runtime.ts";
