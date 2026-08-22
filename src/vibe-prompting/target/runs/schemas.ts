/** Owns durable Target Run request validation and public prompt-revision-pinned trace shapes. */

import { z } from "zod";

import type { TargetActivityPart, TargetRuntimeEvent } from "../activity.ts";

export type TargetRunSource = "ai" | "human";
export type TargetRunTurnStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type TargetReasoningEffort = "low" | "medium" | "high" | "xhigh";

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
  activity: TargetActivityPart[];
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
  source: TargetRunSource;
  startedByName: string | null;
  chatId: string | null;
  effectiveInstructionsHash: string;
  latestStatus: TargetRunTurnStatus;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredTargetRun = TargetRunSummary & { turns: TargetRunTurn[] };

export type TargetRunEvent =
  | TargetRuntimeEvent
  | { type: "finish" }
  | { type: "stopped" }
  | { message: string; type: "error" };

export type TargetRunResponse = {
  run: StoredTargetRun;
  active: boolean;
  events: TargetRunEvent[];
};

export const targetRunCreateInputSchema = z.object({
  instruction: z.string().trim().min(1),
  promptId: z.uuid(),
  promptRevisionId: z.uuid(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  targetModelId: z.string().trim().min(1),
});

export const targetRunTurnInputSchema = z.object({ instruction: z.string().trim().min(1) });

export class TargetRunNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(runId: string) {
    super(`Target Run ${runId} was not found.`);
    this.name = "TargetRunNotFoundError";
  }
}

export class TargetRunConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "TargetRunConflictError";
  }
}

export class TargetRunRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "TargetRunRequestError";
  }
}
