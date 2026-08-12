/** Runs structured-output LLM judges while leaving orchestration, gates, and persistence to their owners. */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type BaseMessageLike, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ZodType } from "zod";

import {
  booleanOutputSchema,
  createCategoricalOutputSchema,
  createNumericOutputSchema,
  type JudgeOutput,
  type JudgeResult,
  type JudgeScoreType,
} from "./schemas.ts";

export type LlmJudgeOptions = {
  instructions: string;
  model: BaseChatModel;
  name: string;
};

const INVALID_NUMERIC_RANGE_MESSAGE =
  "Numeric judge range must contain finite values with minValue below maxValue.";

export abstract class LlmJudge<VALUE, TYPE extends JudgeScoreType> {
  abstract readonly dataType: TYPE;
  readonly instructions: string;
  readonly model: BaseChatModel;
  readonly name: string;

  protected abstract readonly outputSchema: ZodType<JudgeOutput<VALUE>>;

  constructor({ instructions, model, name }: LlmJudgeOptions) {
    this.instructions = requireText(instructions, "Judge instructions");
    this.model = model;
    this.name = requireText(name, "Judge name");
  }

  async evaluate(
    messages: BaseMessageLike[],
    options?: Partial<RunnableConfig>,
  ): Promise<JudgeResult<VALUE, TYPE>> {
    const output = await this.model
      .withStructuredOutput<JudgeOutput<VALUE>>(this.outputSchema)
      .invoke([new SystemMessage(this.instructions), ...messages], options);
    return {
      ...output,
      dataType: this.dataType,
      name: this.name,
    };
  }
}

export class BooleanJudge extends LlmJudge<boolean, "BOOLEAN"> {
  readonly dataType = "BOOLEAN" as const;
  protected readonly outputSchema = booleanOutputSchema;

  constructor(options: LlmJudgeOptions) {
    super(options);
  }
}

export type CategoricalJudgeOptions<CATEGORIES extends readonly [string, ...string[]]> =
  LlmJudgeOptions & {
    categories: CATEGORIES;
  };

export class CategoricalJudge<
  const CATEGORIES extends readonly [string, ...string[]],
> extends LlmJudge<CATEGORIES[number], "CATEGORICAL"> {
  readonly categories: CATEGORIES;
  readonly dataType = "CATEGORICAL" as const;
  protected readonly outputSchema: ZodType<JudgeOutput<CATEGORIES[number]>>;

  constructor({ categories, ...options }: CategoricalJudgeOptions<CATEGORIES>) {
    super(options);
    validateCategories(categories);
    this.categories = categories;
    this.outputSchema = createCategoricalOutputSchema(categories);
  }
}

export type NumericJudgeOptions = LlmJudgeOptions & {
  maxValue: number;
  minValue: number;
};

export class NumericJudge extends LlmJudge<number, "NUMERIC"> {
  readonly dataType = "NUMERIC" as const;
  readonly maxValue: number;
  readonly minValue: number;
  protected readonly outputSchema: ZodType<JudgeOutput<number>>;

  constructor({ maxValue, minValue, ...options }: NumericJudgeOptions) {
    super(options);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue >= maxValue) {
      throw new Error(INVALID_NUMERIC_RANGE_MESSAGE);
    }

    this.maxValue = maxValue;
    this.minValue = minValue;
    this.outputSchema = createNumericOutputSchema(minValue, maxValue);
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function validateCategories(categories: readonly string[]): void {
  if (categories.length < 2) throw new Error("Categorical judges require at least two categories.");

  for (const category of categories) {
    if (requireText(category, "Category") !== category) {
      throw new Error("Categorical judge categories must not contain surrounding whitespace.");
    }
  }
  if (new Set(categories).size !== categories.length)
    throw new Error("Categorical judge categories must be unique.");
}
