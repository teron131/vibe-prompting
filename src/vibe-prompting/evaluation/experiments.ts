/** Persists completed evaluator results through Langfuse experiments without owning Target or judge execution. */

import { type Evaluation, LangfuseClient } from "@langfuse/client";
import { trace } from "@opentelemetry/api";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { createLangfuseClient, createLangfuseTelemetry } from "../clients/langfuse.ts";
import { criteriaSchema, type Criterion } from "../criteria/schemas.ts";
import { type EvaluatorScore, scoreDataType } from "./engine/schemas.ts";

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
  criteria: Criterion[];
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
  private closing: Promise<void> | undefined;

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
      criteria: criteriaSchema.parse(evaluatedCase.criteria),
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

  /** Releases this runner's telemetry without unregistering a provider owned by another host. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      try {
        const outcomes = await Promise.allSettled([
          this.client.shutdown(),
          this.telemetry.shutdown(),
        ]);
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : [],
        );
        if (errors.length)
          throw new AggregateError(errors, "Evaluation telemetry shutdown failed.");
      } finally {
        // SDK providers cache tracers by scope; compare through the public API after shutdown settles.
        const scope = "vibe-prompting.evaluation";
        if (trace.getTracer(scope) === this.telemetry.getTracer(scope)) trace.disable();
      }
    })();
    return this.closing;
  }
}

function toLangfuseEvaluations(scores: EvaluatorScore[], criteria: Criterion[]): Evaluation[] {
  const configuredCriteria = criteriaSchema.parse(criteria);
  const criteriaByName = new Map(
    configuredCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return scores.map((score): Evaluation => {
    const criterion = criteriaByName.get(score.criterionName);
    if (!criterion) throw new Error(`Unknown criterion: ${score.criterionName}.`);
    if (scoreDataType(criterion.type) !== score.dataType) {
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
