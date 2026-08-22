/** Owns browser-safe durable prompt and immutable revision shapes shared by routes and components. */

export type PromptSummary = {
  id: string;
  title: string;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: string;
};

export type PromptEditorSnapshot = PromptSummary & { markdown: string };

export type PromptRevisionSummary = {
  id: string;
  promptId: string;
  parentRevisionId: string | null;
  source: "ai" | "human";
  changeRequest: string | null;
  createdByCurrentUser: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type PromptRevision = PromptRevisionSummary & { markdown: string };
export type PromptDetail = { prompt: PromptEditorSnapshot; revisions: PromptRevisionSummary[] };
export type PromptRevisionResponse = {
  parentMarkdown: string | null;
  revision: PromptRevision;
};
export type PromptSearchPassage = {
  promptId: string;
  revisionId: string;
  text: string;
  start: number;
  end: number;
};
export type PromptSearchResult = PromptSummary & { passages: PromptSearchPassage[] };
export type PromptSearchResponse = { prompts: PromptSearchResult[] };
export type PromptsResponse = { prompts: PromptSummary[] };
