/** Initializes optional Langfuse persistence clients without owning evaluation execution or policy. */

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
const langfuseEnvironmentSchema = z.object({
  LANGFUSE_PUBLIC_KEY: z.string().trim().min(1),
  LANGFUSE_SECRET_KEY: z.string().trim().min(1),
  LANGFUSE_BASE_URL: z.string().trim().url().default(DEFAULT_LANGFUSE_BASE_URL),
});

export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

export function loadLangfuseConfig(environment: NodeJS.ProcessEnv = process.env): LangfuseConfig {
  const config = langfuseEnvironmentSchema.parse(environment);
  return {
    publicKey: config.LANGFUSE_PUBLIC_KEY,
    secretKey: config.LANGFUSE_SECRET_KEY,
    baseUrl: config.LANGFUSE_BASE_URL,
  };
}

/** Returns no persistence configuration when both credentials are absent while rejecting incomplete configuration. */
export function loadOptionalLangfuseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LangfuseConfig | undefined {
  const hasPublicKey = Boolean(environment.LANGFUSE_PUBLIC_KEY?.trim());
  const hasSecretKey = Boolean(environment.LANGFUSE_SECRET_KEY?.trim());
  if (!hasPublicKey && !hasSecretKey) return undefined;
  return loadLangfuseConfig(environment);
}

export function createLangfuseClient(
  config: LangfuseConfig = loadLangfuseConfig(),
): LangfuseClient {
  return new LangfuseClient(config);
}

export function createLangfuseTelemetry(
  config: LangfuseConfig = loadLangfuseConfig(),
): NodeTracerProvider {
  return new NodeTracerProvider({ spanProcessors: [new LangfuseSpanProcessor(config)] });
}
