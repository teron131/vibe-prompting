/** Hosts evaluator workflow topology; the inert node currently exists only to expose the graph in Studio. */

import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";

const EvaluatorState = new StateSchema({});

const evaluate: typeof EvaluatorState.Node = () => ({});

export const evaluatorGraph = new StateGraph(EvaluatorState)
  .addNode("evaluate", evaluate)
  .addEdge(START, "evaluate")
  .addEdge("evaluate", END)
  .compile();
