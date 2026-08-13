/** Exposes one structured evaluation pass as a LangGraph workflow while Langfuse owns experiment execution around it. */

import { END, START, StateGraph } from "@langchain/langgraph";

import { evaluate, EvaluatorInput, EvaluatorOutput, EvaluatorState } from "./nodes.ts";

export const evaluatorGraph = new StateGraph({
  input: EvaluatorInput,
  output: EvaluatorOutput,
  state: EvaluatorState,
})
  .addNode("evaluate", evaluate)
  .addEdge(START, "evaluate")
  .addEdge("evaluate", END)
  .compile();
