/** Publishes the durable Context System boundary while keeping search and workspace mechanics private. */

export {
  ContextConflictError,
  ContextNotFoundError,
  ContextRevisionNotFoundError,
  ContextSystem,
  type AiEditInput,
  type ContextRevisionAuthor,
  type StoredContext,
  type StoredSkill,
  type StoredContextSummary,
  type StoredContextRevision,
  type StoredContextRevisionSummary,
} from "./system.ts";
export type { ContextPassage, ContextPassageHit, StoredContextSearchResult } from "./search.ts";
export { readSkillMetadata, SkillFormatError, type SkillMetadata } from "./skills.ts";
