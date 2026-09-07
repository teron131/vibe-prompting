/** Binds configuration, price caching, and provider accounting to one runtime without retaining a global application database. */

import {
  loadRuntimeConfig,
  type ModelSpendLimits,
  type RuntimeConfig,
} from "../../config/index.ts";
import type { Database } from "../../database/index.ts";
import { createModelPricing } from "./pricing.ts";
import { ModelSpend } from "./spend.ts";

export type ModelContext = ReturnType<typeof createModelContext>;

/** Keeps each application's settings and accounting isolated and drains clients before storage shutdown. */
export function createModelContext(
  readConfig: () => RuntimeConfig = loadRuntimeConfig,
  database?: Database,
  limits?: ModelSpendLimits,
) {
  const pricing = createModelPricing(database);
  const spend = new ModelSpend(pricing, database, limits);
  const controller = new AbortController();
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    readConfig(): RuntimeConfig {
      if (closed) throw new Error("Model runtime is closed.");
      controller.signal.throwIfAborted();
      return readConfig();
    },
    pricing,
    spend,
    signal: controller.signal,
    stop(): void {
      controller.abort(new DOMException("The model runtime is shutting down.", "AbortError"));
    },
    close(): Promise<void> {
      closing ??= (async () => {
        closed = true;
        controller.abort(new DOMException("The model runtime is shutting down.", "AbortError"));
        await spend.close();
        await pricing.close();
      })();
      return closing;
    },
  };
}

// Direct library clients share a database-free context; application services always pass their own.
export const standaloneModelContext = createModelContext();
