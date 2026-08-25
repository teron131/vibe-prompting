/** Publishes the durable Prompt System boundary while keeping search and workspace mechanics private. */

export {
  PromptConflictError,
  PromptNotFoundError,
  PromptRevisionNotFoundError,
  PromptSystem,
  type AiEditInput,
  type PromptRevisionAuthor,
  type StoredPrompt,
  type StoredPromptSummary,
  type StoredPromptRevision,
  type StoredPromptRevisionSummary,
} from "./system.ts";
export type { PromptPassage, PromptPassageHit, StoredPromptSearchResult } from "./search.ts";
