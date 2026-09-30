/** Presents the dedicated human run-planning surface apart from durable results and aggregate analytics. */

import { EvaluationRunBuilder } from "@/components/evaluations/run/builder";

export default async function EvaluationRunPage({
  searchParams,
}: {
  searchParams: Promise<{
    context?: string | string[];
    targetRun?: string | string[];
    targetTurn?: string | string[];
  }>;
}) {
  const { context, targetRun, targetTurn } = await searchParams;
  return (
    <EvaluationRunBuilder
      initialContextId={typeof context === "string" ? context : undefined}
      targetRunId={typeof targetRun === "string" ? targetRun : undefined}
      targetRunTurnId={typeof targetTurn === "string" ? targetTurn : undefined}
    />
  );
}
