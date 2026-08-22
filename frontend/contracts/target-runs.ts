/** Owns browser-safe Target Run trace, activity, and prompt-scoped history shapes shared by routes and UI modes. */

import type { MessagePart, RunEvent } from "./chat";

export type TargetRunActivityPart = Extract<MessagePart, { type: "reasoning" | "tool" }>;
export type TargetReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type TargetRunTurnStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type TargetRunUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type TargetRunTurn = {
  id: string;
  position: number;
  status: TargetRunTurnStatus;
  input: string;
  output: string | null;
  activity: TargetRunActivityPart[];
  usage: TargetRunUsage | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TargetRunSummary = {
  id: string;
  promptId: string;
  promptRevisionId: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetProfileId: string;
  targetProfileName: string;
  targetProfileRevisionId: string;
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  reasoningEffort: TargetReasoningEffort;
  source: "ai" | "human";
  startedByName: string | null;
  chatId: string | null;
  effectiveInstructionsHash: string;
  latestStatus: TargetRunTurnStatus;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TargetRun = TargetRunSummary & { turns: TargetRunTurn[] };

export type TargetRunEvent = Extract<
  RunEvent,
  {
    type:
      | "reasoning-start"
      | "reasoning-delta"
      | "reasoning"
      | "tool"
      | "text-delta"
      | "finish"
      | "stopped"
      | "error";
  }
>;

export type TargetRunResponse = {
  run: TargetRun;
  active: boolean;
  events: TargetRunEvent[];
};

export type TargetRunsResponse = { runs: TargetRunSummary[] };
export type StopTargetRunResponse = { stopped: boolean };
