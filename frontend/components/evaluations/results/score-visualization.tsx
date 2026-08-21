/** Turns durable result scores into compatible comparison fields without inventing one aggregate score. */

import { cn } from "@/components/ui/utils";
import type { Criterion, EvaluationRun, EvaluationScore } from "@/contracts/evaluations";

type CriterionOutcome = { criterion: Criterion; position: number; scores: EvaluationScore[] };
type SignalTone = "negative" | "neutral" | "numeric" | "positive" | "warning";

const POSITIVE_CATEGORIES = new Set(["good", "pass", "passed", "success"]);
const NEGATIVE_CATEGORIES = new Set(["bad", "fail", "failed"]);
const WARNING_CATEGORIES = new Set(["decent", "partial"]);

export function RunScoreOverview({ run }: { run: EvaluationRun }) {
  const outcomes = buildCriterionOutcomes(run);
  if (!outcomes.length) return null;

  return (
    <section className="border-y">
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <h3 className="text-sm font-semibold">Criterion register</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            All cases and judges are shown without combining unlike score types.
          </p>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {run.caseCount} {run.caseCount === 1 ? "CASE" : "CASES"} · {run.judgeModelIds.length}{" "}
          {run.judgeModelIds.length === 1 ? "JUDGE" : "JUDGES"}
          {run.isSyntheticExample ? " · SYNTHETIC EXAMPLE" : ""}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-xs">
          <thead className="bg-muted/35 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-12 px-4 py-2 text-left font-medium sm:px-5">No.</th>
              <th className="px-3 py-2 text-left font-medium">Criterion</th>
              <th className="w-28 px-3 py-2 text-left font-medium">Type</th>
              <th className="w-40 px-3 py-2 text-left font-medium">Result</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Attribution</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {outcomes.map((outcome, index) => (
              <tr key={`${outcome.position}-${outcome.criterion.instruction}`}>
                <td className="px-4 py-3 align-top font-mono text-[11px] text-muted-foreground sm:px-5">
                  {String(index + 1).padStart(2, "0")}
                </td>
                <th className="px-3 py-3 text-left align-top font-normal">
                  <span className="block font-medium">
                    {criterionLabel(outcome.criterion, index)}
                  </span>
                  <span className="mt-1 block max-w-2xl leading-5 text-muted-foreground">
                    {outcome.criterion.instruction}
                  </span>
                </th>
                <td className="px-3 py-3 align-top font-mono text-[11px] uppercase text-muted-foreground">
                  {outcome.criterion.type}
                </td>
                <td className="px-3 py-3 align-top">
                  <OutcomeText outcome={outcome} />
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-[11px] text-muted-foreground">
                  {new Set(outcome.scores.map(({ judgeModelId }) => judgeModelId)).size} JUDGES ·{" "}
                  {outcome.scores.length} FACTS
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutcomeText({ outcome }: { outcome: CriterionOutcome }) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] font-semibold uppercase",
        toneTextClass(outcomeResult(outcome)),
      )}
    >
      {outcomeSummary(outcome)}
    </span>
  );
}

function buildCriterionOutcomes(run: EvaluationRun): CriterionOutcome[] {
  const groups = new Map<string, CriterionOutcome>();
  for (const testCase of run.cases) {
    for (const [position, criterion] of testCase.criteria.entries()) {
      const key = `${criterion.type}\u0000${criterion.instruction}`;
      const group = groups.get(key) ?? { criterion, position: groups.size, scores: [] };
      group.scores.push(...testCase.scores.filter((score) => score.criterionPosition === position));
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

function outcomeResult({ criterion, scores }: CriterionOutcome): SignalTone {
  if (!scores.length) return "neutral";
  if (criterion.type === "boolean") {
    const passed = scores.filter(({ value }) => value === true).length;
    if (passed === scores.length) return "positive";
    return passed ? "warning" : "negative";
  }
  if (criterion.type === "categorical") {
    const tones = scores.map(scoreTone);
    if (tones.includes("negative")) return "negative";
    if (tones.includes("warning")) return "warning";
    if (tones.every((tone) => tone === "positive")) return "positive";
  }
  return criterion.type === "numeric" ? "numeric" : "neutral";
}

function outcomeSummary({ criterion, scores }: CriterionOutcome): string {
  if (!scores.length) return "No result";
  if (criterion.type === "boolean") {
    const passed = scores.filter(({ value }) => value === true).length;
    if (passed === scores.length) return `PASS ${passed}/${scores.length}`;
    if (!passed) return `FAIL 0/${scores.length}`;
    return `PARTIAL ${passed}/${scores.length}`;
  }
  if (criterion.type === "numeric") {
    const values = scores.flatMap(({ value }) => (typeof value === "number" ? [value] : []));
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    return `${formatNumber(average)} / ${criterion.max} AVG`;
  }
  if (criterion.type === "categorical") {
    const counts = new Map<string, number>();
    for (const score of scores)
      counts.set(String(score.value), (counts.get(String(score.value)) ?? 0) + 1);
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => `${value} ${count}`)
      .join(" · ");
  }
  return `${scores.length} ${scores.length === 1 ? "REVIEW" : "REVIEWS"}`;
}

function criterionLabel(criterion: Criterion, index: number): string {
  const named = criterion.instruction.split(/\s+[—–-]\s+|:\s+/, 1)[0]?.trim();
  if (named && named.length <= 28) return named;
  const instruction = criterion.instruction.toLowerCase();
  if (/(language|traditional chinese|english for english)/.test(instruction))
    return "Language behavior";
  if (/(intention|supported work|unsupported|mixed request|scope)/.test(instruction))
    return "Intention gate";
  if (/(tool usage|tool calls?|web_search|search finds|official evidence)/.test(instruction))
    return "Tool usage";
  if (/(response quality|correct|concise|actionable|publishable)/.test(instruction))
    return "Response quality";
  return `Criterion ${index + 1}`;
}

function scoreTone(score: EvaluationScore): SignalTone {
  if (typeof score.value === "boolean") return score.value ? "positive" : "negative";
  if (score.dataType === "NUMERIC") return "numeric";
  if (score.dataType !== "CATEGORICAL") return "neutral";
  const value = String(score.value).trim().toLowerCase();
  if (POSITIVE_CATEGORIES.has(value)) return "positive";
  if (NEGATIVE_CATEGORIES.has(value)) return "negative";
  if (WARNING_CATEGORIES.has(value)) return "warning";
  return "neutral";
}

function toneTextClass(tone: SignalTone): string {
  if (tone === "positive") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive";
  if (tone === "warning") return "text-amber-700 dark:text-amber-400";
  if (tone === "numeric") return "text-sky-700 dark:text-sky-400";
  return "text-muted-foreground";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
