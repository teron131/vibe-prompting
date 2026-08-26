/** Presents one result case as a ruled judge matrix with attributable rationale and evidence. */

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { cn } from "@/components/ui/utils";
import type { Criterion, EvaluationCase, EvaluationScore } from "@/contracts/evaluations";

type Tone = "negative" | "neutral" | "numeric" | "positive" | "warning";

const POSITIVE = new Set(["good", "pass", "passed", "success"]);
const NEGATIVE = new Set(["bad", "fail", "failed"]);
const WARNING = new Set(["decent", "partial"]);

export function ScoreGrid({
  judgeModels,
  testCase,
}: {
  judgeModels: string[];
  testCase: EvaluationCase;
}) {
  const scoresByPosition = new Map<number, EvaluationScore[]>();
  for (const score of testCase.scores) {
    const scores = scoresByPosition.get(score.criterionPosition) ?? [];
    scores.push(score);
    scoresByPosition.set(score.criterionPosition, scores);
  }

  return (
    <div className="border-y">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-xs">
          <thead className="bg-muted/35 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-72 border-r px-4 py-2 text-left font-medium sm:px-5">Criterion</th>
              {judgeModels.map((judge) => (
                <th
                  className="min-w-44 border-r px-3 py-2 text-left font-medium last:border-r-0"
                  key={judge}
                  title={judge}
                >
                  <ModelIdentityLabel modelId={judge} variant="short-id" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {testCase.criteria.map((criterion, position) => (
              <tr key={`${position}-${criterion.name}`}>
                <th className="border-r px-4 py-3 text-left align-top font-normal sm:px-5">
                  <span className="font-mono text-[11px] uppercase text-muted-foreground">
                    C{position + 1} · {criterion.type}
                  </span>
                  <span className="mt-1 block max-w-sm font-medium leading-5">
                    {criterion.name}
                  </span>
                  <span className="mt-1 block max-w-sm leading-5 text-muted-foreground">
                    {criterion.instruction}
                  </span>
                  <CriterionScale
                    criterion={criterion}
                    scores={scoresByPosition.get(position) ?? []}
                  />
                </th>
                {judgeModels.map((judge) => (
                  <td className="border-r px-3 py-3 align-top last:border-r-0" key={judge}>
                    <ScoreCell
                      score={(scoresByPosition.get(position) ?? []).find(
                        (score) => score.judgeModel === judge,
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="border-t">
        <header className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2.5 sm:px-5">
          <h4 className="text-xs font-semibold">Judge Rationale and Evidence</h4>
          <span className="font-mono text-[11px] text-muted-foreground">
            {testCase.scores.length} SCORE FACTS
          </span>
        </header>
        <div className="divide-y">
          {testCase.criteria.map((criterion, position) => (
            <EvidenceGroup
              criterion={criterion}
              position={position}
              scores={scoresByPosition.get(position) ?? []}
              key={`${position}-${criterion.name}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ScoreCell({ score }: { score?: EvaluationScore }) {
  if (!score) return <span className="font-mono text-[11px] text-muted-foreground">NO RESULT</span>;
  const tone = scoreTone(score);
  return (
    <div>
      <span className={cn("font-mono text-[11px] font-semibold uppercase", toneTextClass(tone))}>
        {scoreLabel(score)}
      </span>
      {score.dataType === "NUMERIC" ? <NumericRule score={score} /> : null}
      <span className="mt-1.5 block line-clamp-3 leading-5 text-muted-foreground">
        {score.comment || "No rationale returned."}
      </span>
    </div>
  );
}

function CriterionScale({
  criterion,
  scores,
}: {
  criterion: Criterion;
  scores: EvaluationScore[];
}) {
  if (criterion.type === "boolean") {
    const passed = scores.filter(({ value }) => value === true).length;
    const label = !scores.length
      ? "NO RESULTS"
      : passed === scores.length
        ? `PASS ${passed}/${scores.length}`
        : !passed
          ? `FAIL 0/${scores.length}`
          : `PARTIAL ${passed}/${scores.length}`;
    const tone: Tone = !scores.length
      ? "neutral"
      : passed === scores.length
        ? "positive"
        : !passed
          ? "negative"
          : "warning";
    return (
      <span className={cn("mt-2 block font-mono text-[11px] font-semibold", toneTextClass(tone))}>
        {label}
      </span>
    );
  }
  if (criterion.type === "numeric")
    return (
      <span className="mt-2 block font-mono text-[11px] text-muted-foreground">
        RANGE {criterion.min}–{criterion.max}
      </span>
    );
  if (criterion.type === "categorical")
    return (
      <span className="mt-2 block font-mono text-[11px] uppercase text-muted-foreground">
        {criterion.categories.join(" / ")}
      </span>
    );
  return (
    <span className="mt-2 block font-mono text-[11px] text-muted-foreground">
      ATTRIBUTED REVIEW
    </span>
  );
}

function NumericRule({ score }: { score: EvaluationScore }) {
  if (score.criterion.type !== "numeric" || typeof score.value !== "number") return null;
  const { min, max } = score.criterion;
  const percent = max === min ? 0 : ((score.value - min) / (max - min)) * 100;
  return (
    <div aria-label={`${score.value} on a range from ${min} to ${max}`} className="mt-2">
      <div className="relative h-px bg-border">
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-700 bg-background dark:border-sky-400"
          style={{ left: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function EvidenceGroup({
  criterion,
  position,
  scores,
}: {
  criterion: Criterion;
  position: number;
  scores: EvaluationScore[];
}) {
  return (
    <div className="grid sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="border-b bg-muted/10 px-4 py-3 sm:border-b-0 sm:border-r sm:px-5">
        <span className="font-mono text-[11px] uppercase text-muted-foreground">
          Criterion {position + 1}
        </span>
        <p className="mt-1 text-xs font-medium leading-5">{criterion.name}</p>
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
          {criterion.instruction}
        </p>
      </div>
      <div className="divide-y">
        {scores.length ? (
          scores.map((score) => <ScoreEvidence score={score} key={score.id} />)
        ) : (
          <p className="px-4 py-3 text-xs text-muted-foreground">No judge result was returned.</p>
        )}
      </div>
    </div>
  );
}

function ScoreEvidence({ score }: { score: EvaluationScore }) {
  return (
    <details className="group px-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 marker:content-none">
        <ModelIdentityLabel
          className="min-w-0"
          labelClassName="font-mono text-[11px] font-medium"
          modelId={score.judgeModel}
          variant="short-id"
        />
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] font-semibold uppercase",
            toneTextClass(scoreTone(score)),
          )}
        >
          {scoreLabel(score)}
        </span>
      </summary>
      <div className="mb-3 max-w-3xl border-l pl-3 text-xs leading-5 text-muted-foreground">
        <p>{score.comment || "No rationale was returned."}</p>
        {score.evidence.length ? (
          <ol className="mt-2 space-y-1 font-mono text-[11px]">
            {score.evidence.map((item, index) => (
              <li key={index}>
                <span className="mr-2 text-foreground">{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 font-mono text-[11px]">NO EVIDENCE EXCERPT RETURNED</p>
        )}
      </div>
    </details>
  );
}

function scoreLabel(score: EvaluationScore): string {
  if (typeof score.value === "boolean") return score.value ? "PASS" : "FAIL";
  return String(score.value).trim().toUpperCase();
}

function scoreTone(score: EvaluationScore): Tone {
  if (typeof score.value === "boolean") return score.value ? "positive" : "negative";
  if (score.dataType === "NUMERIC") return "numeric";
  if (score.dataType !== "CATEGORICAL") return "neutral";
  const value = String(score.value).trim().toLowerCase();
  if (POSITIVE.has(value)) return "positive";
  if (NEGATIVE.has(value)) return "negative";
  if (WARNING.has(value)) return "warning";
  return "neutral";
}

function toneTextClass(tone: Tone): string {
  if (tone === "positive") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "negative") return "text-destructive";
  if (tone === "warning") return "text-amber-700 dark:text-amber-400";
  if (tone === "numeric") return "text-sky-700 dark:text-sky-400";
  return "text-muted-foreground";
}
