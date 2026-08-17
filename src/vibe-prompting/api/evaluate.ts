/** Delegates the compact API contract to the evaluator graph and projects its evaluator-owned results. */

import { evaluatorGraph, type EvaluatorScore } from "../agents/evaluator/graph.ts";
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
  type Target,
  targetSchema,
} from "./schemas.ts";

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

  const { results } = await evaluatorGraph.invoke({
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

  const cases = results.map((item, caseIndex) => {
    const configuredCase = configuredCases[caseIndex];
    if (!configuredCase) throw new Error(`Unknown evaluation case index: ${caseIndex}.`);
    return {
      input: configuredCase.input,
      output: item.output as OUTPUT,
      evaluations: item.evaluations.map((evaluation) =>
        projectEvaluation(evaluation, configuredCase.criteria, configuredCase.internalCriteria),
      ),
    };
  });

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

function projectEvaluation(
  evaluation: EvaluatorScore,
  criteria: Criterion[],
  internalCriteria: InternalCriteria,
): CriterionEvaluation {
  const criterionIndex = internalCriteria.findIndex(
    ({ name }) => name === evaluation.criterionName,
  );
  const criterion = criteria[criterionIndex];
  if (!criterion) throw new Error(`Unknown evaluated criterion: ${evaluation.criterionName}.`);
  return {
    criterion,
    value: projectValue(criterion, evaluation.value),
    judge: evaluation.judgeModel,
    comment: evaluation.comment,
    evidence: evaluation.evidence,
  };
}

function projectValue(
  criterion: Criterion,
  value: boolean | number | string,
): boolean | number | string {
  switch (criterion.type) {
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Boolean evaluation must be Boolean.");
      return value;
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
