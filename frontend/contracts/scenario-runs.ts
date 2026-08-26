/** Owns browser-safe Scenario lifecycle, evaluation handoff, and linked Target trace shapes. */

import type { EvaluationRunStatus } from "./evaluations";
import type { TargetReasoningEffort, TargetRun } from "./target-runs";

export type ScenarioRunStatus = EvaluationRunStatus;

type ScenarioRunBase = {
  id: string;
  promptRevisionNumber: number;
  promptTitle: string;
  targetModel: string;
  reasoningEffort: TargetReasoningEffort;
  evaluationErrorMessage: string | null;
  status: ScenarioRunStatus;
  stopReason: "driver-ended" | "maximum-turns" | "static-complete" | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ScenarioRun = ScenarioRunBase &
  (
    | {
        mode: "generative";
        instruction: string;
        driverBrief: string | null;
        driverModel: string;
        maxTurns: number;
      }
    | { mode: "static"; messages: string[] }
  );

export type ScenarioEvaluation = {
  id: string;
  configurationName: string;
  judgeModels: string[];
  status: EvaluationRunStatus;
};

export type ScenarioRunResponse = {
  scenario: ScenarioRun;
  target: TargetRun | null;
  evaluations: ScenarioEvaluation[];
};

export function isScenarioActive({ scenario }: ScenarioRunResponse): boolean {
  return scenario.status === "queued" || scenario.status === "running";
}

export function isScenarioEvaluationActive({ evaluations }: ScenarioRunResponse): boolean {
  return evaluations.some(({ status }) => status === "queued" || status === "running");
}
