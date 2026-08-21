/** Owns browser-safe durable prompt and immutable revision shapes shared by routes and components. */

export type PromptSummary = {
  activeRevisionId: string;
  activeRevisionNumber: number;
  canRedo: boolean;
  canUndo: boolean;
  createdAt: string;
  id: string;
  revisionCount: number;
  revisionId: string;
  revisionNumber: number;
  title: string;
  updatedAt: string;
};

export type PromptEditorSnapshot = PromptSummary & { markdown: string };

export type PromptRevisionSummary = {
  changeRequest: string | null;
  createdAt: string;
  id: string;
  parentRevisionId: string | null;
  promptId: string;
  source: "ai" | "human";
};

export type PromptRevision = PromptRevisionSummary & { markdown: string };
export type PromptDetail = { prompt: PromptEditorSnapshot; revisions: PromptRevisionSummary[] };
export type PromptRevisionResponse = {
  parentMarkdown: string | null;
  revision: PromptRevision;
};
export type PromptSearchPassage = {
  end: number;
  promptId: string;
  revisionId: string;
  start: number;
  text: string;
};
export type PromptSearchResult = PromptSummary & { passages: PromptSearchPassage[] };
export type PromptSearchResponse = { prompts: PromptSearchResult[] };
export type PromptsResponse = { prompts: PromptSummary[] };
