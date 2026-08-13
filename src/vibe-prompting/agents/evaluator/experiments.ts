/** Runs Target tasks through Langfuse experiments and converts structured judge reports into native scores. */

import {
  type Evaluation,
  type ExperimentItem,
  type ExperimentTask,
  LangfuseClient,
} from "@langfuse/client";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

import { createLangfuseClient, createLangfuseTelemetry } from "../../clients/langfuse.ts";
import {
  createEvaluationReportSchema,
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  type EvaluationReport,
} from "../../evaluation/schemas.ts";
import { evaluateCriteria } from "./judge.ts";

export const evaluatorModelsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .refine((models) => new Set(models).size === models.length, {
    message: "Evaluator models must be unique.",
  });

export type EvaluatorExperimentOptions<
  INPUT = unknown,
  EXPECTED_OUTPUT = unknown,
  METADATA extends Record<string, unknown> = Record<string, unknown>,
> = {
  criteria: EvaluationCriteria;
  data: ExperimentItem<INPUT, EXPECTED_OUTPUT, METADATA>[];
  description?: string;
  evaluatorModels: string[];
  maxConcurrency?: number;
  metadata?: Record<string, unknown>;
  name: string;
  runName?: string;
  task: ExperimentTask<INPUT, EXPECTED_OUTPUT, METADATA>;
};

export type LangfuseExperimentRunnerOptions = {
  client?: LangfuseClient;
  telemetry?: NodeTracerProvider;
};

/** Keeps one telemetry provider alive for the runner lifetime and flushes each completed experiment before returning. */
export class LangfuseExperimentRunner {
  readonly client: LangfuseClient;
  readonly telemetry: NodeTracerProvider;

  private closed = false;
  private started = false;

  constructor({
    client = createLangfuseClient(),
    telemetry = createLangfuseTelemetry(),
  }: LangfuseExperimentRunnerOptions = {}) {
    this.client = client;
    this.telemetry = telemetry;
  }

  async run<
    INPUT = unknown,
    EXPECTED_OUTPUT = unknown,
    METADATA extends Record<string, unknown> = Record<string, unknown>,
  >({
    criteria,
    data,
    description,
    evaluatorModels,
    maxConcurrency,
    metadata,
    name,
    runName,
    task,
  }: EvaluatorExperimentOptions<INPUT, EXPECTED_OUTPUT, METADATA>) {
    this.start();
    const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
    const configuredEvaluatorModels = evaluatorModelsSchema.parse(evaluatorModels);

    try {
      return await this.client.experiment.run({
        data,
        description,
        evaluators: configuredEvaluatorModels.map(
          (evaluatorModel) =>
            async ({ expectedOutput, input, metadata: itemMetadata, output }) => {
              const evaluation = await evaluateCriteria({
                criteria: configuredCriteria,
                evaluatorModel,
                expectedOutput,
                input,
                metadata: itemMetadata,
                output,
              });
              return toLangfuseEvaluations(evaluation, configuredCriteria, evaluatorModel);
            },
        ),
        maxConcurrency,
        metadata: { ...metadata, evaluatorModels: configuredEvaluatorModels },
        name,
        runName,
        task,
      });
    } finally {
      await Promise.all([this.client.flush(), this.telemetry.forceFlush()]);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([this.client.shutdown(), this.telemetry.shutdown()]);
  }

  private start(): void {
    if (this.closed) throw new Error("Langfuse experiment runner is closed.");
    if (this.started) return;
    this.telemetry.register();
    this.started = true;
  }
}

export function toLangfuseEvaluations(
  report: EvaluationReport,
  criteria: EvaluationCriteria,
  evaluatorModel: string,
): Evaluation[] {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const validatedReport = createEvaluationReportSchema(configuredCriteria).parse(report);
  const criteriaByName = new Map(
    configuredCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return validatedReport.results.map((result): Evaluation => {
    const criterion = criteriaByName.get(result.name);
    if (!criterion) throw new Error(`Unknown criterion: ${result.name}.`);
    return {
      comment: result.comment,
      dataType: result.dataType,
      metadata: {
        criterion: criterion.instructions,
        criterionName: result.name,
        evaluatorModel,
        evidence: result.evidence,
      },
      name: `${result.name}@${evaluatorModel}`,
      value: result.dataType === "BOOLEAN" ? (result.value ? 1 : 0) : result.value,
    };
  });
}
