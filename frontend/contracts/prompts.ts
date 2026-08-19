/** Owns browser-safe durable prompt and immutable revision shapes shared by routes and components. */

export type PromptSummary = {
  createdAt: string;
  id: string;
  markdown: string;
  revisionCount: number;
  revisionId: string;
  title: string;
  updatedAt: string;
};

export type PromptRevision = {
  changeRequest: string | null;
  createdAt: string;
  id: string;
  markdown: string;
  parentRevisionId: string | null;
  promptId: string;
  source: "operator" | "user";
};

export type PromptDetail = { prompt: PromptSummary; revisions: PromptRevision[] };
export type PromptSearchResult = PromptSummary & { snippet: string };
export type PromptSearchResponse = { prompts: PromptSearchResult[] };
export type PromptsResponse = { prompts: PromptSummary[] };
