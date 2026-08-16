/** Publishes opt-in runtime adapters separately from the opaque evaluator contract. */

export {
  AiSdkAdapter,
  type AiSdkInput,
  type AiSdkRunOptions,
  type AiSdkRunResult,
  type AiSdkStructuredRunResult,
} from "./ai-sdk-adapter.ts";
export {
  LangChainAdapter,
  type LangChainAgentInput,
  type LangChainAgentOutput,
  type LangChainInput,
  type LangChainRunResult,
  type LangChainStructuredRunResult,
} from "./langchain-adapter.ts";
export {
  allocateTargetRuns,
  type TargetModelMode,
  type TargetModels,
  targetModelModeSchema,
  type TargetRun,
} from "./model-runs.ts";
