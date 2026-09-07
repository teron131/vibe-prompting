/** Owns the process-shared application instance, retryable initialization, replacement, and host shutdown integration. */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

import { resolveModelIdentities } from "../clients/llm/models-dev.ts";
import {
  type ApplicationServices,
  type ConfiguredModel,
  createApplicationServices,
} from "./application.ts";

const shared = globalThis as typeof globalThis & {
  vibePromptingServicesVersion?: number;
  vibePromptingServices?: Promise<ApplicationServices>;
  vibePromptingRuntimeStopping?: boolean;
};
const RUNTIME_VERSION = 37;

/** Initializes one shared runtime and clears failed attempts so corrected configuration can be retried. */
export function getApplicationServices(): Promise<ApplicationServices> {
  if (shared.vibePromptingRuntimeStopping) {
    return Promise.reject(
      Object.assign(new Error("The application runtime is shutting down."), { statusCode: 503 }),
    );
  }
  if (!shared.vibePromptingServices || shared.vibePromptingServicesVersion !== RUNTIME_VERSION) {
    const previous = shared.vibePromptingServices;
    shared.vibePromptingServicesVersion = RUNTIME_VERSION;
    const services = (async () => {
      const prior = await previous?.catch(() => undefined);
      await prior?.close();
      const local = resolve(process.cwd(), ".env");
      loadDotenv({
        override: false,
        quiet: true,
        path: existsSync(local) ? local : resolve(process.cwd(), "..", ".env"),
      });
      return createApplicationServices();
    })();
    shared.vibePromptingServices = services;
    void services.catch(() => {
      if (shared.vibePromptingServices === services) shared.vibePromptingServices = undefined;
    });
  }
  const selected = shared.vibePromptingServices;
  return selected.then(async (services) => {
    if (!services.closed) return services;
    await services.close();
    if (shared.vibePromptingServices === selected) shared.vibePromptingServices = undefined;
    return getApplicationServices();
  });
}

/** Closes the selected shared instance without closing a replacement initialized by another caller. */
export async function closeApplicationServices(): Promise<void> {
  const selected = shared.vibePromptingServices;
  if (!selected) return;
  try {
    await (await selected).close();
  } finally {
    if (shared.vibePromptingServices === selected) shared.vibePromptingServices = undefined;
  }
}

export async function getConfiguredModels(): Promise<ConfiguredModel[]> {
  return (await getApplicationServices()).getConfiguredModels();
}

export async function isConfiguredModelId(id: string): Promise<boolean> {
  return (await getApplicationServices()).isConfiguredModelId(id);
}

export async function getModelIdentity(id: string): Promise<ConfiguredModel> {
  const [identity] = await resolveModelIdentities([id]);
  return { id, ...identity };
}

/** Registers disposal only at an executable host boundary, leaving imported libraries free of process hooks. */
export function registerShutdown(close: () => Promise<unknown>, exitAfterClose = false): void {
  let closing: Promise<unknown> | undefined;
  const shutdown = () => {
    shared.vibePromptingRuntimeStopping = true;
    closing ??= Promise.resolve()
      .then(close)
      .catch((error: unknown) => {
        console.error({ event: "runtime-shutdown-failed", error });
        process.exitCode = 1;
      })
      .finally(() => {
        if (exitAfterClose) process.exit(process.exitCode ? Number(process.exitCode) : 0);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
