/** Runs structured-output LLM judges while leaving workflow policy and persistence to their owners. */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type BaseMessageLike, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ZodType } from "zod";

import { buildCriteriaPrompt, buildCriteriaSystemPrompt } from "./prompts.ts";
import {
  booleanOutputSchema,
  createCategoricalOutputSchema,
  createEvaluationReportSchema,
  createNumericOutputSchema,
  type EvaluationCriteria,
  evaluationCriteriaSchema,
  type EvaluationReport,
  type EvaluationSubject,
  type JudgeOutput,
  type JudgeResult,
  type JudgeScoreType,
} from "./schemas.ts";

export type LlmJudgeOptions = {
  model: BaseChatModel;
  name: string;
  instruction: string;
};

export type CriteriaEvaluatorOptions = {
  model: BaseChatModel;
  criteria: EvaluationCriteria;
};

export class CriteriaEvaluator {
  readonly model: BaseChatModel;
  readonly criteria: EvaluationCriteria;
  private readonly outputSchema: ReturnType<typeof createEvaluationReportSchema>;

  constructor({ model, criteria }: CriteriaEvaluatorOptions) {
    this.criteria = evaluationCriteriaSchema.parse(criteria);
    this.model = model;
    this.outputSchema = createEvaluationReportSchema(this.criteria);
  }

  async evaluate(
    subject: EvaluationSubject,
    options?: Partial<RunnableConfig>,
  ): Promise<EvaluationReport> {
    return this.model
      .withStructuredOutput<EvaluationReport>(this.outputSchema)
      .invoke(
        [
          new SystemMessage(buildCriteriaSystemPrompt(this.criteria)),
          new HumanMessage(buildCriteriaPrompt(subject, this.criteria)),
        ],
        options,
      );
  }
}

const INVALID_NUMERIC_RANGE_MESSAGE =
  "Numeric judge range must contain finite values with minValue below maxValue.";

export abstract class LlmJudge<VALUE, TYPE extends JudgeScoreType> {
  abstract readonly dataType: TYPE;
  readonly model: BaseChatModel;
  readonly name: string;
  readonly instruction: string;

  protected abstract readonly outputSchema: ZodType<JudgeOutput<VALUE>>;

  constructor({ model, name, instruction }: LlmJudgeOptions) {
    this.model = model;
    this.name = requireText(name, "Judge name");
    this.instruction = requireText(instruction, "Judge instruction");
  }

  async evaluate(
    messages: BaseMessageLike[],
    options?: Partial<RunnableConfig>,
  ): Promise<JudgeResult<VALUE, TYPE>> {
    const output = await this.model
      .withStructuredOutput<JudgeOutput<VALUE>>(this.outputSchema)
      .invoke([new SystemMessage(this.instruction), ...messages], options);
    return {
      name: this.name,
      dataType: this.dataType,
      ...output,
    };
  }
}

export class BooleanJudge extends LlmJudge<boolean, "BOOLEAN"> {
  readonly dataType = "BOOLEAN" as const;
  protected readonly outputSchema = booleanOutputSchema;
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
  minValue: number;
  maxValue: number;
};

export class NumericJudge extends LlmJudge<number, "NUMERIC"> {
  readonly dataType = "NUMERIC" as const;
  readonly minValue: number;
  readonly maxValue: number;
  protected readonly outputSchema: ZodType<JudgeOutput<number>>;

  constructor({ minValue, maxValue, ...options }: NumericJudgeOptions) {
    super(options);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue >= maxValue) {
      throw new Error(INVALID_NUMERIC_RANGE_MESSAGE);
    }

    this.minValue = minValue;
    this.maxValue = maxValue;
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
