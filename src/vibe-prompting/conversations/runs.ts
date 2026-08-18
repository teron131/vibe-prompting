/** Owns one-active-run claims, detached event publication, and idempotent process-local cancellation for general chats. */

export type ConversationRunEvent =
  | { delta: string; type: "text-delta" }
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
  | { report: unknown; type: "evaluation" }
  | { promptId: string; revisionId: string; type: "prompt-revision" }
  | { message: string; type: "error" }
  | { type: "stopped" }
  | { type: "finish" };

type RunListener = (event: ConversationRunEvent) => void;

type ActiveRun = {
  controller: AbortController;
  done: Promise<void>;
  listeners: Set<RunListener>;
  settled: boolean;
};

export class ActiveChatRunError extends Error {
  readonly statusCode = 409;

  constructor(chatId: string) {
    super(`Chat ${chatId} already has an active agent run.`);
    this.name = "ActiveChatRunError";
  }
}

export type ClaimedConversationRun = {
  fail(error: unknown): void;
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

    const controller = new AbortController();
    let resolveDone: () => void = () => undefined;
    const run: ActiveRun = {
      controller,
      done: new Promise<void>((resolve) => {
        resolveDone = resolve;
      }),
      listeners: new Set(),
      settled: false,
    };
    this.#runs.set(chatId, run);

    const publish = (event: ConversationRunEvent) => {
      if (run.settled) return;
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
      fail(error) {
        publish({ type: "error", message: safeErrorMessage(error) });
        release();
      },
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

  isActive(chatId: string): boolean {
    return this.#runs.has(chatId);
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
