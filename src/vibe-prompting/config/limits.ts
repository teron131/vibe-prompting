/** Loads optional deployment-wide model spend limits without enabling restrictions when configuration is absent. */

import { z } from "zod";

const optionalPositiveNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().finite().positive().optional(),
);
const optionalPositiveInteger = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);
const environmentSchema = z
  .object({
    MODEL_SPEND_LIMIT_USD: optionalPositiveNumber,
    MODEL_SPEND_WINDOW_HOURS: optionalPositiveInteger,
  })
  .superRefine((value, context) => {
    if (
      (value.MODEL_SPEND_LIMIT_USD === undefined) !==
      (value.MODEL_SPEND_WINDOW_HOURS === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "MODEL_SPEND_LIMIT_USD and MODEL_SPEND_WINDOW_HOURS must be configured together.",
      });
    }
  });

export type ModelSpendLimits = {
  spendUsd: number;
  windowHours: number;
};

export function loadModelSpendLimits(
  environment: NodeJS.ProcessEnv = process.env,
): ModelSpendLimits | undefined {
  const value = environmentSchema.parse(environment);
  if (value.MODEL_SPEND_LIMIT_USD === undefined || value.MODEL_SPEND_WINDOW_HOURS === undefined)
    return undefined;
  return {
    spendUsd: value.MODEL_SPEND_LIMIT_USD,
    windowHours: value.MODEL_SPEND_WINDOW_HOURS,
  };
}
