/** Allocates deterministic Target-model runs without constructing runtimes or invoking agents. */

import { z } from "zod";

export const targetModelModeSchema = z.enum(["round-robin", "all"]);

export type TargetModelMode = z.infer<typeof targetModelModeSchema>;
export type TargetModels<MODEL extends string = string> = MODEL | readonly MODEL[];
export type TargetRun<ITEM, MODEL extends string = string> = {
  model: MODEL;
  data: ITEM[];
};

export function allocateTargetRuns<ITEM, MODEL extends string>(
  model: TargetModels<MODEL>,
  data: readonly ITEM[],
  mode: TargetModelMode = "round-robin",
): TargetRun<ITEM, MODEL>[] {
  const models = parseModels(model);
  const selectedMode = targetModelModeSchema.parse(mode);
  if (data.length === 0) throw new Error("Target data must contain at least one item.");

  if (selectedMode === "all") {
    return models.map((selectedModel) => ({ model: selectedModel, data: [...data] }));
  }

  const runs = models.map((selectedModel) => ({ model: selectedModel, data: [] as ITEM[] }));
  data.forEach((item, index) => runs[index % runs.length].data.push(item));
  return runs.filter((run) => run.data.length > 0);
}

function parseModels<MODEL extends string>(model: TargetModels<MODEL>): MODEL[] {
  const values = (Array.isArray(model) ? model : [model]) as MODEL[];
  if (values.length === 0) throw new Error("Target models must contain at least one model ID.");
  const models = values.map((value) => value.trim() as MODEL);
  if (models.some((value) => !value)) throw new Error("Target model IDs must not be empty.");
  if (new Set(models).size !== models.length) throw new Error("Target model IDs must be unique.");
  return models;
}
