/** Owns browser-safe Target Run trace, activity, and prompt-scoped history shapes shared by routes and UI modes. */

import type { MessagePart, RunEvent } from "./chat";

export type TargetRunActivityPart = Extract<MessagePart, { type: "reasoning" | "tool" }>;
export type TargetReasoningEffort = "high" | "low" | "medium" | "xhigh";

export type TargetRunTurnStatus = "completed" | "failed" | "interrupted" | "running";

export type TargetRunUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type TargetRunTurn = {
  activity: TargetRunActivityPart[];
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  id: string;
  input: string;
  output: string | null;
  position: number;
  status: TargetRunTurnStatus;
  usage: TargetRunUsage | null;
};

export type TargetRunSummary = {
  chatId: string | null;
  createdAt: string;
  effectiveInstructionsHash: string;
  id: string;
  latestStatus: TargetRunTurnStatus;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  reasoningEffort: TargetReasoningEffort;
  source: "ai" | "human";
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  targetProfileId: string;
  targetProfileName: string;
  targetProfileRevisionId: string;
  turnCount: number;
  updatedAt: string;
};

export type TargetRun = TargetRunSummary & { turns: TargetRunTurn[] };

export type TargetRunEvent = Extract<
  RunEvent,
  {
    type:
      | "error"
      | "finish"
      | "reasoning"
      | "reasoning-delta"
      | "reasoning-start"
      | "stopped"
      | "text-delta"
      | "tool";
  }
>;

export type TargetRunResponse = {
  active: boolean;
  events: TargetRunEvent[];
  run: TargetRun;
};

export type TargetRunsResponse = { runs: TargetRunSummary[] };
export type StopTargetRunResponse = { stopped: boolean };
