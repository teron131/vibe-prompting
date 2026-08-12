/** Initializes Langfuse API and tracing clients without owning experiment execution or evaluator policy. */

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export function createLangfuseClient(): LangfuseClient {
  return new LangfuseClient();
}

export function createLangfuseTelemetry(): NodeTracerProvider {
  return new NodeTracerProvider({ spanProcessors: [new LangfuseSpanProcessor()] });
}
