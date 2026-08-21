/** Publishes primitive external-service clients and direct model clients without agent-runtime adaptation. */

export {
  embedSearchDocuments,
  embedSearchQuery,
  EmbeddingError,
  SEARCH_EMBEDDING_DIMENSIONS,
  SEARCH_EMBEDDING_MODEL,
} from "./embedding.ts";
export {
  EXA_WEB_SEARCH_TOOL,
  type ExaWebSearchInput,
  type ExaWebSearchResult,
  searchExaWeb,
} from "./exa.ts";
export {
  createLangfuseClient,
  createLangfuseTelemetry,
  type LangfuseConfig,
  loadLangfuseConfig,
} from "./langfuse.ts";
export {
  createModel as createLangChainModel,
  type ModelOptions as LangChainModelOptions,
} from "./llm/langchain.ts";
