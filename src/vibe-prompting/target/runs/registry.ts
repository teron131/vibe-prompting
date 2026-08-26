/** Owns process-local Target Run event replay, bounded concurrency, and cancellation without becoming durable trace storage. */

import type { TargetRunEvent } from "./schemas.ts";

type ActiveRun = {
  controller: AbortController;
  events: TargetRunEvent[];
};

type WaitingRun = {
  reject: (reason: unknown) => void;
  resolve: (claim: TargetRunClaim) => void;
  runId: string;
};

export type TargetRunClaim = {
  publish: (event: TargetRunEvent) => void;
  release: () => void;
  signal: AbortSignal;
};

const DEFAULT_MAX_ACTIVE_TARGET_RUNS = 10;

export class TargetRunCapacityError extends Error {
  readonly statusCode = 429;

  constructor(maxActiveRuns: number) {
    super(`At most ${maxActiveRuns} Target Runs may be active at once.`);
    this.name = "TargetRunCapacityError";
  }
}

export class TargetRunRegistry {
  readonly #maxActiveRuns: number;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #waiting: WaitingRun[] = [];

  constructor(maxActiveRuns: number = DEFAULT_MAX_ACTIVE_TARGET_RUNS) {
    if (!Number.isInteger(maxActiveRuns) || maxActiveRuns < 1) {
      throw new Error("Target Run concurrency must be a positive integer.");
    }
    this.#maxActiveRuns = maxActiveRuns;
  }

  claim(runId: string): TargetRunClaim {
    this.#requireAvailableRunId(runId);
    if (this.#runs.size >= this.#maxActiveRuns) {
      throw new TargetRunCapacityError(this.#maxActiveRuns);
    }
    return this.#activate(runId);
  }

  /** Waits for Target-owned capacity so coordinating workflows never copy its numeric limit. */
  claimWhenAvailable(runId: string): Promise<TargetRunClaim> {
    this.#requireAvailableRunId(runId);
    if (this.#runs.size < this.#maxActiveRuns) return Promise.resolve(this.#activate(runId));
    return new Promise((resolve, reject) => {
      this.#waiting.push({ reject, resolve, runId });
    });
  }

  #activate(runId: string): TargetRunClaim {
    const run: ActiveRun = { controller: new AbortController(), events: [] };
    this.#runs.set(runId, run);
    return {
      publish: (event: TargetRunEvent) => {
        const latest = run.events.at(-1);
        if (
          (event.type === "text-delta" && latest?.type === "text-delta") ||
          (event.type === "reasoning-delta" && latest?.type === "reasoning-delta")
        ) {
          latest.delta += event.delta;
        } else {
          run.events.push(event);
        }
      },
      release: () => {
        if (this.#runs.get(runId) !== run) return;
        this.#runs.delete(runId);
        this.#activateWaitingRuns();
      },
      signal: run.controller.signal,
    };
  }

  #activateWaitingRuns(): void {
    while (this.#runs.size < this.#maxActiveRuns) {
      const waiting = this.#waiting.shift();
      if (!waiting) return;
      waiting.resolve(this.#activate(waiting.runId));
    }
  }

  #requireAvailableRunId(runId: string): void {
    if (this.#runs.has(runId) || this.#waiting.some((waiting) => waiting.runId === runId)) {
      throw new Error(`Target Run ${runId} is already active or waiting.`);
    }
  }

  snapshot(runId: string): { active: boolean; events: TargetRunEvent[] } {
    const run = this.#runs.get(runId);
    return run
      ? { active: true, events: structuredClone(run.events) }
      : { active: false, events: [] };
  }

  stop(runId: string): boolean {
    const run = this.#runs.get(runId);
    if (run) {
      if (!run.controller.signal.aborted) {
        run.controller.abort(new DOMException("The Target Run was stopped.", "AbortError"));
      }
      return true;
    }
    const waitingIndex = this.#waiting.findIndex((waiting) => waiting.runId === runId);
    if (waitingIndex < 0) return false;
    const [waiting] = this.#waiting.splice(waitingIndex, 1);
    waiting?.reject(new DOMException("The Target Run was stopped.", "AbortError"));
    return true;
  }
}
