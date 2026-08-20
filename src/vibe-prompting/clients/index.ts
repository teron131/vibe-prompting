/** Publishes configured client factories while keeping provider routing inside each client owner. */

export {
  embedSearchDocuments,
  embedSearchQuery,
  EmbeddingError,
  SEARCH_EMBEDDING_DIMENSIONS,
  SEARCH_EMBEDDING_MODEL,
} from "./embedding.ts";
export {
  connectAiSdkExaSearch,
  connectLangChainExaTools,
  connectOpenAiAgentsExaSearch,
  EXA_WEB_SEARCH_TOOL,
  type AiSdkExaTools,
  type LangChainExaTools,
} from "./exa.ts";
export {
  createLangfuseClient,
  createLangfuseTelemetry,
  type LangfuseConfig,
  loadLangfuseConfig,
} from "./langfuse.ts";
export { createModel as createAiSdkModel } from "./llm/ai-sdk.ts";
export {
  createModel as createLangChainModel,
  type ModelOptions as LangChainModelOptions,
} from "./llm/langchain.ts";
export { createModel as createOpenAiAgentsModel } from "./llm/openai-agents.ts";
