/** Owns process-local Target Run event replay, bounded concurrency, and cancellation without becoming durable trace storage. */

import type { TargetRunEvent } from "./schemas.ts";

type ActiveRun = {
  controller: AbortController;
  events: TargetRunEvent[];
};

const MAX_ACTIVE_TARGET_RUNS = 10;

export class TargetRunCapacityError extends Error {
  readonly statusCode = 429;

  constructor() {
    super(`At most ${MAX_ACTIVE_TARGET_RUNS} Target Runs may be active at once.`);
    this.name = "TargetRunCapacityError";
  }
}

export class TargetRunRegistry {
  readonly #runs = new Map<string, ActiveRun>();

  claim(runId: string) {
    if (this.#runs.has(runId)) throw new Error(`Target Run ${runId} is already active.`);
    if (this.#runs.size >= MAX_ACTIVE_TARGET_RUNS) throw new TargetRunCapacityError();
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
        if (this.#runs.get(runId) === run) this.#runs.delete(runId);
      },
      signal: run.controller.signal,
    };
  }

  snapshot(runId: string): { active: boolean; events: TargetRunEvent[] } {
    const run = this.#runs.get(runId);
    return run
      ? { active: true, events: structuredClone(run.events) }
      : { active: false, events: [] };
  }

  stop(runId: string): boolean {
    const run = this.#runs.get(runId);
    if (!run) return false;
    if (!run.controller.signal.aborted) {
      run.controller.abort(new DOMException("The Target Run was stopped.", "AbortError"));
    }
    return true;
  }
}
