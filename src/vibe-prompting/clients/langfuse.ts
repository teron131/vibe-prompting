/** Initializes Langfuse API and OpenTelemetry clients without owning experiment or evaluator workflow policy. */

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** Creates the API client used for datasets, experiments, prompts, and scores. */
export function createLangfuseClient(): LangfuseClient {
  return new LangfuseClient();
}

/** Creates the OpenTelemetry runtime required to deliver experiment traces to Langfuse. */
export function createLangfuseTelemetry(): NodeTracerProvider {
  return new NodeTracerProvider({ spanProcessors: [new LangfuseSpanProcessor()] });
}
