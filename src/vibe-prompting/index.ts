/** Publishes the transport-neutral evaluation facade while keeping runtime adapters and workflow internals opt-in. */

export * from "./api/index.ts";
export {
  allocateTargetRuns,
  type TargetModelMode,
  type TargetModels,
  targetModelModeSchema,
  type TargetRun,
} from "./agents/target/model-runs.ts";
export * from "./clients/index.ts";
export {
  CONFIG_PATH,
  DEFAULT_CLIPROXYAPI_BASE_URL,
  EXA_MCP_URL,
  GEMINI_OPENAI_BASE_URL,
  loadRuntimeConfig,
  type ModelConfig,
  type PlatformConfig,
  type PlatformId,
  type RuntimeConfig,
} from "./config.ts";
export * from "./evaluation/index.ts";
export * from "./tools/index.ts";
