/** Owns browser-safe durable context and immutable revision shapes shared by routes and components. */

import type { SkillMetadata } from "vibe-prompting/skills";

export type ContextSummary = {
  id: string;
  title: string;
  skill?: SkillMetadata;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: string;
};

export type ContextEditorSnapshot = ContextSummary & { markdown: string };

export type ContextRevisionSummary = {
  id: string;
  contextId: string;
  parentRevisionId: string | null;
  source: "ai" | "human";
  changeRequest: string | null;
  createdByCurrentUser: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type ContextRevision = ContextRevisionSummary & { markdown: string };
export type ContextDetail = { context: ContextEditorSnapshot; revisions: ContextRevisionSummary[] };
export type ContextRevisionResponse = {
  parentMarkdown: string | null;
  revision: ContextRevision;
};
export type ContextSearchPassage = {
  contextId: string;
  revisionId: string;
  text: string;
  start: number;
  end: number;
};
export type ContextSearchResult = ContextSummary & { passages: ContextSearchPassage[] };
export type ContextSearchResponse = { contexts: ContextSearchResult[] };
export type ContextsResponse = { contexts: ContextSummary[] };
