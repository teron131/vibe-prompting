/** Publishes the transport-independent Evaluation System contract without exposing engine internals. */

export {
  evaluate,
  type Criterion,
  type CriterionEvaluation,
  type EvaluatedCase,
  type EvaluationCase,
  type EvaluationRequest,
  type EvaluationRun,
} from "./api.ts";
export * from "./criteria-profiles.ts";
export * from "./runs/index.ts";
export * from "./results/index.ts";
