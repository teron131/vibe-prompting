/** Delegates the compact API contract to the evaluator graph and projects its experiment into framework-neutral results. */

import type { Evaluation as LangfuseEvaluation } from "@langfuse/client";

import { evaluatorGraph } from "../agents/evaluator/graph.ts";
import type {
  EvaluationCriteria as InternalCriteria,
  EvaluationCriterion as InternalCriterion,
} from "../evaluation/schemas.ts";
import {
  type Criterion,
  type CriterionEvaluation,
  type EvaluationRequest,
  type EvaluationRun,
  requestSchema,
  scoreMetadataSchema,
  type Target,
  targetSchema,
} from "./schemas.ts";

type CaseMetadata = {
  caseIndex: number;
};

/** Evaluates opaque input-output behavior and returns only public case results. */
export async function evaluate<INPUT, OUTPUT>(
  target: Target<INPUT, OUTPUT>,
  request: EvaluationRequest<INPUT>,
): Promise<EvaluationRun<INPUT, OUTPUT>> {
  const configuredTarget = targetSchema.parse(target) as Target<INPUT, OUTPUT>;
  const configuredRequest = requestSchema.parse(request) as EvaluationRequest<INPUT>;
  const configuredCases = configuredRequest.cases.map((testCase) => ({
    ...testCase,
    internalCriteria: testCase.criteria.map(toInternalCriterion),
  }));

  const { experiment } = await evaluatorGraph.invoke({
    target: {
      model: configuredTarget.model,
      invoke: (input: unknown) => configuredTarget.invoke(input as INPUT),
    },
    runName: configuredTarget.model,
    cases: configuredCases.map(({ input, internalCriteria }) => ({
      input,
      criteria: internalCriteria,
    })),
    judges: { model: configuredRequest.judges },
  });

  const cases = experiment.itemResults
    .map((item) => {
      const caseIndex = requireCaseIndex(item.item.metadata as CaseMetadata | undefined);
      const configuredCase = configuredCases[caseIndex];
      if (!configuredCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
      return {
        caseIndex,
        input: configuredCase.input,
        output: item.output as OUTPUT,
        evaluations: item.evaluations.map((evaluation) =>
          projectEvaluation(evaluation, configuredCase.criteria, configuredCase.internalCriteria),
        ),
      };
    })
    .sort((left, right) => left.caseIndex - right.caseIndex)
    .map(({ caseIndex: _caseIndex, ...result }) => result);

  return { cases };
}

function toInternalCriterion(criterion: Criterion, index: number): InternalCriterion {
  const name = criterion.type === "correction" ? "output" : `criterion_${index + 1}`;
  switch (criterion.type) {
    case "boolean":
      return { name, dataType: "BOOLEAN", instruction: criterion.instruction };
    case "categorical":
      return {
        name,
        dataType: "CATEGORICAL",
        categories: criterion.categories,
        instruction: criterion.instruction,
      };
    case "numeric":
      return {
        name,
        dataType: "NUMERIC",
        minValue: criterion.min,
        maxValue: criterion.max,
        instruction: criterion.instruction,
      };
    case "text":
      return { name, dataType: "TEXT", instruction: criterion.instruction };
    case "correction":
      return { name: "output", dataType: "CORRECTION", instruction: criterion.instruction };
  }
}

function requireCaseIndex(metadata: CaseMetadata | undefined): number {
  const caseIndex = metadata?.caseIndex;
  if (typeof caseIndex !== "number" || !Number.isInteger(caseIndex) || caseIndex < 0) {
    throw new Error("Evaluation case metadata is missing a valid case index.");
  }
  return caseIndex;
}

function projectEvaluation(
  evaluation: LangfuseEvaluation,
  criteria: Criterion[],
  internalCriteria: InternalCriteria,
): CriterionEvaluation {
  const metadata = scoreMetadataSchema.parse(evaluation.metadata);
  const criterionIndex = internalCriteria.findIndex(({ name }) => name === metadata.criterionName);
  const criterion = criteria[criterionIndex];
  if (!criterion) throw new Error(`Unknown evaluated criterion: ${metadata.criterionName}.`);
  if (typeof evaluation.comment !== "string" || evaluation.comment.trim().length === 0) {
    throw new Error(`Evaluation comment is missing for criterion: ${metadata.criterionName}.`);
  }
  return {
    criterion,
    value: projectValue(criterion, evaluation.value),
    judge: metadata.judgeModel,
    comment: evaluation.comment,
    evidence: metadata.evidence,
  };
}

function projectValue(criterion: Criterion, value: number | string): boolean | number | string {
  switch (criterion.type) {
    case "boolean":
      if (value !== 0 && value !== 1)
        throw new Error("Boolean evaluation must be stored as 0 or 1.");
      return value === 1;
    case "categorical":
      if (typeof value !== "string" || !criterion.categories.includes(value)) {
        throw new Error("Categorical evaluation must use one of the configured categories.");
      }
      return value;
    case "numeric":
      if (typeof value !== "number" || value < criterion.min || value > criterion.max) {
        throw new Error("Numeric evaluation must be within the configured range.");
      }
      return value;
    case "text":
    case "correction":
      if (typeof value !== "string") throw new Error("Text evaluation must contain text.");
      return value;
  }
}
