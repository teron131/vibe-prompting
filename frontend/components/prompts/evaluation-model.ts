/** Projects detailed evaluation scores into criterion-level outcomes for the prompt workspace's result-first summary. */

import type { Criterion, EvaluationRun, EvaluationScore } from "../../contracts/evaluations";

export type PromptCriterionOutcome = {
  evidence: string[];
  instruction: string;
  name: string;
  result: "fail" | "neutral" | "pass";
  summary: string;
  type: Criterion["type"];
};

export function buildPromptCriterionOutcomes(run: EvaluationRun): PromptCriterionOutcome[] {
  const groups = new Map<string, { criterion: Criterion; scores: EvaluationScore[] }>();
  for (const testCase of run.cases) {
    for (const [position, criterion] of testCase.criteria.entries()) {
      const key = `${criterion.type}\u0000${criterion.name}`;
      const group = groups.get(key) ?? { criterion, scores: [] };
      group.scores.push(...testCase.scores.filter((score) => score.criterionPosition === position));
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ criterion, scores }) => ({
    evidence: collectEvidence(scores),
    instruction: criterion.instruction,
    name: criterion.name,
    result: outcomeResult(criterion, scores),
    summary: outcomeSummary(criterion, scores),
    type: criterion.type,
  }));
}

function outcomeResult(
  criterion: Criterion,
  scores: EvaluationScore[],
): PromptCriterionOutcome["result"] {
  if (criterion.type !== "boolean" || scores.length === 0) return "neutral";
  return scores.every(({ value }) => value === true) ? "pass" : "fail";
}

function outcomeSummary(criterion: Criterion, scores: EvaluationScore[]): string {
  if (!scores.length) return "No result";
  if (criterion.type === "boolean") {
    const passed = scores.filter(({ value }) => value === true).length;
    return `${passed} of ${scores.length} passed`;
  }
  if (criterion.type === "numeric") {
    const values = scores.flatMap(({ value }) => (typeof value === "number" ? [value] : []));
    if (!values.length) return "No numeric result";
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return `Average ${formatNumber(average)} of ${criterion.max}`;
  }
  if (criterion.type === "categorical") {
    const counts = new Map<string, number>();
    for (const score of scores) {
      const value = String(score.value);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => `${value} ${count}`)
      .join(" · ");
  }
  return `${scores.length} ${scores.length === 1 ? "review" : "reviews"}`;
}

function collectEvidence(scores: EvaluationScore[]): string[] {
  const evidence: string[] = [];
  for (const score of scores) {
    for (const item of score.evidence) {
      const text = item.trim();
      if (text && !evidence.includes(text)) evidence.push(text);
      if (evidence.length === 2) return evidence;
    }
  }
  const comment = scores.find(({ comment }) => comment.trim())?.comment.trim();
  return comment ? [comment] : [];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
