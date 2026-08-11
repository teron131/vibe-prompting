/** Exposes configured factories that return native LangChain model clients. */

export { createEmbeddingModel, type EmbeddingModelOptions } from "./embedding.ts";
export { createChatModel, type ChatModelOptions } from "./llm.ts";
