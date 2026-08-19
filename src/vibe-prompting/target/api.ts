/** Owns the small opaque Target contract and runtime validation consumed by Evaluation and external callers. */

import { z } from "zod";

export type Target<INPUT = unknown, OUTPUT = unknown> = {
  readonly model: string;
  invoke(input: INPUT): PromiseLike<OUTPUT>;
};

export const targetSchema = z.custom<Target>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "model" in value &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model === value.model.trim() &&
    "invoke" in value &&
    typeof value.invoke === "function",
  "Target must expose a non-empty model ID and an invoke function.",
);
