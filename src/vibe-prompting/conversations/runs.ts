/** Owns one-active-run claims, detached event publication, and idempotent process-local cancellation for general chats. */

export type ConversationRunEvent =
  | { delta: string; type: "text-delta" }
  | { type: "reasoning-start" }
  | { delta: string; type: "reasoning-delta" }
  | { chatId: string; icon: string; title: string; type: "chat-metadata" }
  | {
      callId: string;
      input?: unknown;
      name: string;
      output?: unknown;
      state: "completed" | "failed" | "running";
      summary?: string;
      type: "tool";
    }
  | { summary: string; type: "reasoning" }
  | { promptId: string; revisionId: string; type: "prompt-revision" }
  | { message: string; type: "error" }
  | { type: "stopped" }
  | { type: "finish" };

type RunListener = (event: ConversationRunEvent) => void;
const MAX_ACTIVE_RUNS = 10;

type ActiveRun = {
  controller: AbortController;
  done: Promise<void>;
  events: ConversationRunEvent[];
  listeners: Set<RunListener>;
  settled: boolean;
};

export type ConversationRunSnapshot = {
  active: boolean;
  events: ConversationRunEvent[];
};

export class ActiveChatRunError extends Error {
  readonly statusCode = 409;

  constructor(chatId: string) {
    super(`Chat ${chatId} already has an active agent run.`);
    this.name = "ActiveChatRunError";
  }
}

export class ChatRunCapacityError extends Error {
  readonly statusCode = 429;

  constructor() {
    super(`At most ${MAX_ACTIVE_RUNS} chat runs may be active at once.`);
    this.name = "ChatRunCapacityError";
  }
}

export type ClaimedConversationRun = {
  publish(event: ConversationRunEvent): void;
  release(): void;
  signal: AbortSignal;
  start(operation: () => Promise<void>): void;
  subscribe(listener: RunListener): () => void;
};

export class ConversationRunRegistry {
  readonly #runs = new Map<string, ActiveRun>();

  claim(chatId: string): ClaimedConversationRun {
    if (this.#runs.has(chatId)) throw new ActiveChatRunError(chatId);
    if (this.#runs.size >= MAX_ACTIVE_RUNS) throw new ChatRunCapacityError();

    const controller = new AbortController();
    let resolveDone: () => void = () => undefined;
    const run: ActiveRun = {
      controller,
      done: new Promise<void>((resolve) => {
        resolveDone = resolve;
      }),
      events: [],
      listeners: new Set(),
      settled: false,
    };
    this.#runs.set(chatId, run);

    const publish = (event: ConversationRunEvent) => {
      if (run.settled) return;
      const lastEvent = run.events.at(-1);
      if (event.type === "text-delta" && lastEvent?.type === "text-delta") {
        run.events[run.events.length - 1] = {
          ...lastEvent,
          delta: lastEvent.delta + event.delta,
        };
      } else if (event.type === "reasoning-delta" && lastEvent?.type === "reasoning-delta") {
        run.events[run.events.length - 1] = {
          ...lastEvent,
          delta: lastEvent.delta + event.delta,
        };
      } else {
        run.events.push(event);
      }
      for (const listener of run.listeners) listener(event);
    };
    const release = () => {
      if (run.settled) return;
      run.settled = true;
      run.listeners.clear();
      if (this.#runs.get(chatId) === run) this.#runs.delete(chatId);
      resolveDone();
    };

    return {
      publish,
      release,
      signal: controller.signal,
      start(operation) {
        void operation().then(release, (error) => {
          if (controller.signal.aborted) publish({ type: "stopped" });
          else publish({ type: "error", message: safeErrorMessage(error) });
          release();
        });
      },
      subscribe(listener) {
        if (run.settled) return () => undefined;
        run.listeners.add(listener);
        return () => run.listeners.delete(listener);
      },
    };
  }

  snapshot(chatId: string): ConversationRunSnapshot {
    const run = this.#runs.get(chatId);
    return run ? { active: true, events: [...run.events] } : { active: false, events: [] };
  }

  stop(chatId: string): boolean {
    const run = this.#runs.get(chatId);
    if (!run) return false;
    if (!run.controller.signal.aborted) {
      run.controller.abort(new DOMException("The agent run was stopped.", "AbortError"));
    }
    return true;
  }

  async stopAndWait(chatId: string): Promise<boolean> {
    const run = this.#runs.get(chatId);
    if (!run) return false;
    this.stop(chatId);
    await run.done;
    return true;
  }
}

function safeErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.message;
  }
  return "The agent run failed.";
}
