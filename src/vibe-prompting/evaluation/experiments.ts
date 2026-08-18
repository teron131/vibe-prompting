/** Persists completed evaluator results through Langfuse experiments without owning Target or judge execution. */

import { type Evaluation, LangfuseClient } from "@langfuse/client";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { createLangfuseClient, createLangfuseTelemetry } from "../clients/langfuse.ts";
import {
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  type EvaluatorScore,
} from "./schemas.ts";

type EvaluatedCase<
  INPUT = unknown,
  OUTPUT = unknown,
  EXPECTED_OUTPUT = unknown,
  METADATA extends Record<string, unknown> = Record<string, unknown>,
> = {
  input: INPUT;
  output: OUTPUT;
  expectedOutput?: EXPECTED_OUTPUT;
  metadata?: METADATA;
  criteria: EvaluationCriteria;
  scores: EvaluatorScore[];
};

type LangfuseExperimentOptions<
  INPUT = unknown,
  OUTPUT = unknown,
  EXPECTED_OUTPUT = unknown,
  METADATA extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  cases: EvaluatedCase<INPUT, OUTPUT, EXPECTED_OUTPUT, METADATA>[];
  runName?: string;
  description?: string;
  maxConcurrency?: number;
  metadata?: Record<string, unknown>;
};

type LangfuseExperimentRunnerOptions = {
  client?: LangfuseClient;
  telemetry?: NodeTracerProvider;
};

/** Keeps one telemetry provider alive for the runner lifetime and flushes each persisted experiment before returning. */
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

  startTracing(): void {
    if (this.closed) throw new Error("Langfuse experiment runner is closed.");
    if (this.started) return;
    this.telemetry.register();
    this.started = true;
  }

  async persist<
    INPUT = unknown,
    OUTPUT = unknown,
    EXPECTED_OUTPUT = unknown,
    METADATA extends Record<string, unknown> = Record<string, unknown>,
  >({
    name,
    cases,
    runName,
    description,
    maxConcurrency,
    metadata,
  }: LangfuseExperimentOptions<INPUT, OUTPUT, EXPECTED_OUTPUT, METADATA>): Promise<void> {
    this.startTracing();
    const evaluatedCases = cases.map((evaluatedCase, caseIndex) => ({
      ...evaluatedCase,
      criteria: evaluationCriteriaSchema.parse(evaluatedCase.criteria),
      metadata: { ...evaluatedCase.metadata, caseIndex },
    }));
    const judgeModels = [
      ...new Set(
        evaluatedCases.flatMap(({ scores }) => scores.map(({ judgeModel }) => judgeModel)),
      ),
    ];

    try {
      await this.client.experiment.run({
        name,
        data: evaluatedCases.map(({ input, expectedOutput, metadata: itemMetadata }) => ({
          input,
          expectedOutput,
          metadata: itemMetadata,
        })),
        task: async (item) => requireEvaluatedCase(evaluatedCases, item.metadata).output,
        evaluators: [
          async ({ metadata: itemMetadata }) => {
            const evaluatedCase = requireEvaluatedCase(evaluatedCases, itemMetadata);
            return toLangfuseEvaluations(evaluatedCase.scores, evaluatedCase.criteria);
          },
        ],
        runName,
        description,
        maxConcurrency,
        metadata: {
          ...metadata,
          evaluationCriteria: "per-item",
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
}

function toLangfuseEvaluations(
  scores: EvaluatorScore[],
  criteria: EvaluationCriteria,
): Evaluation[] {
  const configuredCriteria = evaluationCriteriaSchema.parse(criteria);
  const criteriaByName = new Map(
    configuredCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return scores.map((score): Evaluation => {
    const criterion = criteriaByName.get(score.criterionName);
    if (!criterion) throw new Error(`Unknown criterion: ${score.criterionName}.`);
    if (criterion.dataType !== score.dataType) {
      throw new Error(`Criterion data type changed: ${score.criterionName}.`);
    }
    return {
      name: `${score.criterionName}@${score.judgeModel}`,
      dataType: score.dataType,
      value: toLangfuseValue(score),
      comment: score.comment,
      metadata: {
        criterionName: score.criterionName,
        criterion: criterion.instruction,
        judgeModel: score.judgeModel,
        evidence: score.evidence,
      },
    };
  });
}

function requireEvaluatedCase<
  INPUT,
  OUTPUT,
  EXPECTED_OUTPUT,
  METADATA extends Record<string, unknown>,
>(
  cases: EvaluatedCase<INPUT, OUTPUT, EXPECTED_OUTPUT, METADATA>[],
  metadata: unknown,
): EvaluatedCase<INPUT, OUTPUT, EXPECTED_OUTPUT, METADATA> {
  const caseIndex =
    typeof metadata === "object" && metadata !== null && "caseIndex" in metadata
      ? metadata.caseIndex
      : undefined;
  if (typeof caseIndex !== "number" || !Number.isInteger(caseIndex) || caseIndex < 0) {
    throw new Error("Langfuse experiment item is missing a valid case index.");
  }
  const evaluatedCase = cases[caseIndex];
  if (!evaluatedCase) throw new Error(`Unknown Langfuse experiment case index: ${caseIndex}.`);
  return evaluatedCase;
}

function toLangfuseValue(score: EvaluatorScore): number | string {
  if (score.dataType === "BOOLEAN") return toStoredBoolean(score.value);
  if (typeof score.value === "boolean") {
    throw new Error(`Non-Boolean evaluation cannot contain a Boolean: ${score.criterionName}.`);
  }
  return score.value;
}

function toStoredBoolean(value: boolean | number | string): number {
  if (typeof value !== "boolean") throw new Error("Boolean evaluation must be Boolean.");
  return value ? 1 : 0;
}
