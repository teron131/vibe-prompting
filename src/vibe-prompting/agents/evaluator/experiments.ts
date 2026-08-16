/** Runs Target tasks through Langfuse experiments and converts structured judge reports into native scores. */

import {
  type Evaluation,
  type ExperimentItem,
  type ExperimentTask,
  LangfuseClient,
} from "@langfuse/client";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { createLangfuseClient, createLangfuseTelemetry } from "../../clients/langfuse.ts";
import {
  createEvaluationReportSchema,
  type EvaluationCriteria,
  evaluationCriteriaSchema,
} from "../../evaluation/schemas.ts";
import {
  evaluateWithJudges,
  getJudgeModels,
  type JudgeEvaluation,
  type Judges,
  judgesSchema,
} from "./judges.ts";

export type EvaluatorExperimentOptions<
  INPUT = unknown,
  EXPECTED_OUTPUT = unknown,
  METADATA extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  data: ExperimentItem<INPUT, EXPECTED_OUTPUT, METADATA>[];
  task: ExperimentTask<INPUT, EXPECTED_OUTPUT, METADATA>;
  criteria: EvaluationCriteria;
  judges: Judges;
  runName?: string;
  description?: string;
  maxConcurrency?: number;
  metadata?: Record<string, unknown>;
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
    name,
    data,
    task,
    criteria,
    judges,
    runName,
    description,
    maxConcurrency,
    metadata,
  }: EvaluatorExperimentOptions<INPUT, EXPECTED_OUTPUT, METADATA>) {
    this.start();
    const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
    const configuredJudges = judgesSchema.parse(judges);
    const judgeModels = getJudgeModels(configuredJudges);

    try {
      return await this.client.experiment.run({
        name,
        data,
        task,
        evaluators: [
          async ({ input, output, expectedOutput, metadata: itemMetadata }) => {
            const evaluations = await evaluateWithJudges(
              {
                input,
                output,
                expectedOutput,
                metadata: itemMetadata,
              },
              configuredCriteria,
              configuredJudges,
            );
            return evaluations.flatMap((evaluation) =>
              toLangfuseEvaluations(evaluation, configuredCriteria),
            );
          },
        ],
        runName,
        description,
        maxConcurrency,
        metadata: {
          ...metadata,
          evaluationCriteria: configuredCriteria.map(({ name: criterion }) => criterion),
          judgeModels,
        },
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
  evaluation: JudgeEvaluation,
  criteria: EvaluationCriteria,
): Evaluation[] {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const validatedReport = createEvaluationReportSchema(configuredCriteria).parse(evaluation.report);
  const criteriaByName = new Map(
    configuredCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return validatedReport.results.map((result): Evaluation => {
    const criterion = criteriaByName.get(result.name);
    if (!criterion) throw new Error(`Unknown criterion: ${result.name}.`);
    return {
      name: `${result.name}@${evaluation.model}`,
      dataType: result.dataType,
      value: result.dataType === "BOOLEAN" ? (result.value ? 1 : 0) : result.value,
      comment: result.comment,
      metadata: {
        criterionName: result.name,
        criterion: criterion.instruction,
        judgeModel: evaluation.model,
        evidence: result.evidence,
      },
    };
  });
}
