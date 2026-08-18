/** Visualizes attributed evaluation facts without collapsing unlike criteria, ranges, cases, or judges into one score. */

import { Check, Minus, X } from "lucide-react";

import type { EvaluationCase, EvaluationScore } from "@/contracts/evaluations";

export function ScoreGrid({ judges, testCase }: { judges: string[]; testCase: EvaluationCase }) {
  const scoresByPosition = new Map<number, EvaluationScore[]>();
  for (const score of testCase.scores) {
    const scores = scoresByPosition.get(score.criterionPosition) ?? [];
    scores.push(score);
    scoresByPosition.set(score.criterionPosition, scores);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[34rem] border-collapse text-xs">
          <thead>
            <tr className="bg-secondary/60 text-left">
              <th className="px-3 py-2 font-medium">Criterion</th>
              {judges.map((judge) => (
                <th className="px-3 py-2 font-medium" key={judge}>
                  {judge}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {testCase.criteria.map((criterion, position) => (
              <tr className="border-t" key={`${position}-${criterion.instruction}`}>
                <th className="max-w-64 px-3 py-2 text-left font-normal">
                  <span className="line-clamp-2">{criterion.instruction}</span>
                  <span className="mt-1 block text-[10px] uppercase text-muted-foreground">
                    {criterion.type}
                  </span>
                </th>
                {judges.map((judge) => (
                  <td className="px-3 py-2" key={judge}>
                    <ScoreCell
                      score={(scoresByPosition.get(position) ?? []).find(
                        (score) => score.judgeModelId === judge,
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {testCase.criteria.map((criterion, position) => (
        <CriterionSummary
          criterion={criterion}
          key={`${position}-${criterion.instruction}`}
          scores={scoresByPosition.get(position) ?? []}
        />
      ))}
    </div>
  );
}

function ScoreCell({ score }: { score?: EvaluationScore }) {
  if (!score)
    return (
      <span aria-label="No result" className="text-muted-foreground">
        <Minus className="size-3.5" />
      </span>
    );
  if (typeof score.value === "boolean")
    return score.value ? (
      <span className="inline-flex items-center gap-1 text-chart-2">
        <Check className="size-3.5" />
        Pass
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-destructive">
        <X className="size-3.5" />
        Fail
      </span>
    );
  return <span className="line-clamp-2 max-w-52">{String(score.value)}</span>;
}

function CriterionSummary({
  criterion,
  scores,
}: {
  criterion: EvaluationCase["criteria"][number];
  scores: EvaluationScore[];
}) {
  if (criterion.type === "boolean") {
    const passed = scores.filter(({ value }) => value === true).length;
    const percent = scores.length ? (passed / scores.length) * 100 : 0;
    return (
      <section className="rounded-lg border bg-card p-3">
        <div className="flex items-start justify-between gap-3 text-xs">
          <div className="font-medium">{criterion.instruction}</div>
          <div className="shrink-0 text-muted-foreground">
            {passed}/{scores.length} pass
          </div>
        </div>
        <div
          aria-label={`${percent}% passed`}
          className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
        >
          <div className="h-full rounded-full bg-chart-2" style={{ width: `${percent}%` }} />
        </div>
        <ScoreDetails scores={scores} />
      </section>
    );
  }
  if (criterion.type === "numeric") {
    return (
      <section className="rounded-lg border bg-card p-3">
        <div className="text-xs font-medium">{criterion.instruction}</div>
        <div className="mt-3 space-y-2">
          {scores.map((score) => {
            const numeric = typeof score.value === "number" ? score.value : criterion.min;
            const percent = ((numeric - criterion.min) / (criterion.max - criterion.min)) * 100;
            return (
              <div key={score.id}>
                <div className="flex justify-between text-xs">
                  <span>{score.judgeModelId}</span>
                  <span>
                    {numeric} · {criterion.min}–{criterion.max}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <ScoreDetails scores={scores} />
      </section>
    );
  }
  if (criterion.type === "categorical") {
    const counts = criterion.categories.map((category) => ({
      category,
      count: scores.filter(({ value }) => value === category).length,
    }));
    return (
      <section className="rounded-lg border bg-card p-3">
        <div className="text-xs font-medium">{criterion.instruction}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {counts.map(({ category, count }) => (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs" key={category}>
              {category} · {count}
            </span>
          ))}
        </div>
        <ScoreDetails scores={scores} />
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="text-xs font-medium">{criterion.instruction}</div>
      <div className="mt-3 space-y-2">
        {scores.map((score) => (
          <details className="rounded-md bg-secondary/60 px-3 py-2 text-xs" key={score.id}>
            <summary className="cursor-pointer font-medium">
              {score.judgeModelId} · {criterion.type === "correction" ? "Correction" : "Review"}
            </summary>
            <div className="mt-2 whitespace-pre-wrap">{String(score.value)}</div>
            <ScoreEvidence score={score} />
          </details>
        ))}
      </div>
    </section>
  );
}

function ScoreDetails({ scores }: { scores: EvaluationScore[] }) {
  return (
    <div className="mt-3 space-y-1">
      {scores.map((score) => (
        <details className="text-xs text-muted-foreground" key={score.id}>
          <summary className="cursor-pointer">
            {score.judgeModelId} · rationale and evidence
          </summary>
          <ScoreEvidence score={score} />
        </details>
      ))}
    </div>
  );
}

function ScoreEvidence({ score }: { score: EvaluationScore }) {
  return (
    <div className="mt-2 space-y-2">
      <p>{score.comment}</p>
      {score.evidence.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {score.evidence.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>No evidence excerpt was returned.</p>
      )}
    </div>
  );
}
