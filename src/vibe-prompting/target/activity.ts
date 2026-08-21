/** Defines the provider-neutral reasoning and tool activity shared by Target execution, persistence, and browser replay. */

export type TargetActivityPart =
  | { summary: string; type: "reasoning" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "failed" | "running";
      summary?: string;
      type: "tool";
    };

export type TargetRuntimeEvent =
  | { delta: string; type: "text-delta" }
  | { type: "reasoning-start" }
  | { delta: string; type: "reasoning-delta" }
  | TargetActivityPart;
