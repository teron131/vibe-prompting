/** Projects durable Target Run state into the chat messages and bounded transcript consumed by browser presentation. */

import type { ChatMessage } from "@/contracts/chat";
import type { TargetRun, TargetRunEvent, TargetRunTurn } from "@/contracts/target-runs";

import { projectAssistantParts } from "../assistant-message";

export type TargetTraceMessage = { content: string; role: "assistant" | "user" };

export function projectTargetRunMessages(
  run: TargetRun | undefined,
  events: TargetRunEvent[],
): ChatMessage[] {
  if (!run) return [];
  return run.turns.flatMap((turn) => [
    {
      chatId: run.id,
      createdAt: turn.createdAt,
      id: `${turn.id}-input`,
      metadata: { targetRunId: run.id, targetRunTurnId: turn.id },
      parts: [{ text: turn.input, type: "text" as const }],
      role: "user" as const,
    },
    {
      chatId: run.id,
      createdAt: turn.completedAt ?? turn.createdAt,
      id: turn.id,
      metadata: { targetRunId: run.id, targetRunTurnId: turn.id },
      parts: projectTurnParts(turn, turn.status === "running" ? events : []),
      role: "assistant" as const,
    },
  ]);
}

export function projectCompletedTargetTrace(
  run: TargetRun | undefined,
  selectedTurn: TargetRunTurn | undefined,
): TargetTraceMessage[] {
  if (!run || !selectedTurn) return [];
  return run.turns
    .filter(({ position, status }) => position <= selectedTurn.position && status === "completed")
    .flatMap((turn) => [
      { content: turn.input, role: "user" as const },
      ...(turn.output !== null ? [{ content: turn.output, role: "assistant" as const }] : []),
    ]);
}

function projectTurnParts(turn: TargetRunTurn, events: TargetRunEvent[]): ChatMessage["parts"] {
  if (turn.output) return [...turn.activity, { text: turn.output, type: "text" }];
  if (turn.status === "running") return projectAssistantParts(events);
  if (turn.errorMessage) {
    return [
      {
        text: `Target turn ${turn.status}: ${turn.errorMessage}`,
        type: "text",
      },
    ];
  }
  return [];
}
