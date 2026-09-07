/** Publishes validated runtime and optional limit configuration without exposing configuration persistence as an active service. */

export { loadModelSpendLimits, type ModelSpendLimits } from "./limits.ts";
export {
  CONFIG_PATH,
  type ConfiguredPlatform,
  DEFAULT_CLIPROXYAPI_BASE_URL,
  GEMINI_OPENAI_BASE_URL,
  getModelStorage,
  loadRuntimeConfig,
  type ModelConfig,
  type ModelStorage,
  parseModelCatalog,
  parseModelConfig,
  type PlatformConfig,
  type PlatformId,
  resolveModelPlatform,
  type RuntimeConfig,
  type RuntimeConfigOverrides,
  saveLocalModelSettings,
  applyRuntimeOverrides,
} from "./runtime.ts";
