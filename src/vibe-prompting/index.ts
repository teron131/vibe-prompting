/** Publishes the evaluation facade without starting its HTTP or MCP runtimes. */

export { evaluate } from "./app/api.ts";
export {
  type Criterion,
  type CriterionEvaluation,
  type EvaluatedCase,
  type EvaluationCase,
  type EvaluationRequest,
  type EvaluationRun,
  type Target,
} from "./app/schemas.ts";
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
