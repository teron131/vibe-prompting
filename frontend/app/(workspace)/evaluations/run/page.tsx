/** Presents the dedicated human run-planning surface apart from durable results and aggregate analytics. */

import { EvaluationRunBuilder } from "@/components/evaluations/run/builder";

export default async function EvaluationRunPage({
  searchParams,
}: {
  searchParams: Promise<{ targetRun?: string | string[]; targetTurn?: string | string[] }>;
}) {
  const { targetRun, targetTurn } = await searchParams;
  return (
    <EvaluationRunBuilder
      targetRunId={typeof targetRun === "string" ? targetRun : undefined}
      targetRunTurnId={typeof targetTurn === "string" ? targetTurn : undefined}
    />
  );
}
