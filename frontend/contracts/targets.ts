/** Owns browser-safe target profile and runtime configuration shapes shared by routes and evaluation views. */

export type TargetConfiguration = {
  maxOutputTokens?: number;
  maxSteps?: number;
  tools?: Array<"web-search">;
};

export type TargetProfile = {
  configuration: TargetConfiguration;
  createdAt: string;
  id: string;
  instructions: string;
  name: string;
  promptId: string;
  revisionId: string;
  revisionNumber: number;
  updatedAt: string;
};

export type TargetProfileResponse = { profile: TargetProfile | null };
