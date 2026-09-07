/** Owns the standalone evaluator resources used by the LangGraph development host without opening application storage. */

import { createModelContext } from "../clients/llm/context.ts";
import { createEvaluationEngine } from "../evaluation/engine/graph.ts";
import { registerShutdown } from "./runtime.ts";

const models = createModelContext();
const evaluator = createEvaluationEngine(models);
export const evaluatorGraph = evaluator.graph;

registerShutdown(async () => {
  models.stop();
  await evaluator.close();
  await models.close();
});
