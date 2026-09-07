/** Owns bounded process-local draining and shutdown while domains retain durable claims and terminal transitions. */

type QueueOptions = {
  name: string;
  concurrency: number;
  claim(): Promise<string | undefined>;
  execute(id: string, signal: AbortSignal): Promise<void>;
};

/** Starts only after recovery and settles every claimed operation before shutdown resolves. */
export class RunQueue {
  readonly #options: QueueOptions;
  readonly #active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  readonly #preparing = new Set<Promise<unknown>>();
  #started = false;
  #closed = false;
  #requested = false;
  #draining: Promise<void> | undefined;
  #closing: Promise<void> | undefined;

  constructor(options: QueueOptions) {
    this.#options = options;
  }

  start(): void {
    this.assertOpen();
    this.#started = true;
    this.wake();
  }

  assertOpen(): void {
    if (this.#closed) throw new Error(`${this.#options.name} queue is closed.`);
  }

  /** Keeps accepted preparation alive until its durable record is ready, including during shutdown. */
  prepare<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const pending = Promise.resolve().then(operation);
    this.#preparing.add(pending);
    void pending.then(
      () => this.#preparing.delete(pending),
      () => this.#preparing.delete(pending),
    );
    return pending;
  }

  wake(): void {
    if (!this.#started || this.#closed) return;
    this.#requested = true;
    if (this.#draining) return;
    this.#draining = this.#drain()
      .catch((error: unknown) => {
        console.error({ event: "queue-drain-failed", queue: this.#options.name, error });
      })
      .finally(() => {
        this.#draining = undefined;
        if (this.#requested && !this.#closed) this.wake();
      });
  }

  cancel(id: string, reason: unknown): void {
    this.#active.get(id)?.controller.abort(reason);
  }

  /** Aborts active work, handles any claim already in flight, and waits for domain cleanup. */
  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#requested = false;
    for (const { controller } of this.#active.values()) controller.abort(shutdownReason());
    await Promise.allSettled(this.#preparing);
    await this.#draining;
    await Promise.allSettled([...this.#active.values()].map(({ done }) => done));
  }

  async #drain(): Promise<void> {
    while (this.#requested && !this.#closed) {
      this.#requested = false;
      while (!this.#closed && this.#active.size < this.#options.concurrency) {
        const id = await this.#options.claim();
        if (!id) break;
        const controller = new AbortController();
        if (this.#closed) controller.abort(shutdownReason());
        const done = Promise.resolve()
          .then(() => this.#options.execute(id, controller.signal))
          .catch((error: unknown) => {
            console.error({
              event: "queue-execution-failed",
              queue: this.#options.name,
              id,
              error,
            });
          })
          .finally(() => {
            this.#active.delete(id);
            this.wake();
          });
        this.#active.set(id, { controller, done });
      }
    }
  }
}

function shutdownReason(): DOMException {
  return new DOMException("The application runtime is shutting down.", "AbortError");
}
