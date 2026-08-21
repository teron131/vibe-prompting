/** Owns durable Target Run request validation and public prompt-revision-pinned trace shapes. */

import { z } from "zod";

import type { TargetActivityPart, TargetRuntimeEvent } from "../activity.ts";

export type TargetRunSource = "ai" | "human";
export type TargetRunTurnStatus = "completed" | "failed" | "interrupted" | "running";
export type TargetReasoningEffort = "high" | "low" | "medium" | "xhigh";

export type TargetRunUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type TargetRunTurn = {
  activity: TargetActivityPart[];
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
  source: TargetRunSource;
  targetConfiguration: Record<string, unknown>;
  targetModelId: string;
  targetProfileId: string;
  targetProfileName: string;
  targetProfileRevisionId: string;
  turnCount: number;
  updatedAt: string;
};

export type StoredTargetRun = TargetRunSummary & { turns: TargetRunTurn[] };

export type TargetRunEvent =
  | TargetRuntimeEvent
  | { message: string; type: "error" }
  | { type: "finish" }
  | { type: "stopped" };

export type TargetRunResponse = {
  active: boolean;
  events: TargetRunEvent[];
  run: StoredTargetRun;
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
