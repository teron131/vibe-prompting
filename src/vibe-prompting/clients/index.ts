/** Publishes configured client factories while keeping provider routing inside each client owner. */

export {
  embedSearchDocuments,
  embedSearchQuery,
  EmbeddingError,
  PROMPT_SEARCH_EMBEDDING_DIMENSIONS,
  PROMPT_SEARCH_EMBEDDING_MODEL,
} from "./embedding.ts";
export { connectExaSearch, EXA_WEB_SEARCH_TOOL, loadExaTools, type ExaTools } from "./exa.ts";
export {
  createLangfuseClient,
  createLangfuseTelemetry,
  type LangfuseConfig,
  loadLangfuseConfig,
} from "./langfuse.ts";
export { createChatModel, type ChatModelOptions } from "./llm.ts";
