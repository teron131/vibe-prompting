/** Presents one durable prompt-bound evaluation report inside the shared evaluation workspace. */

import { EvaluationReport } from "@/components/evaluations/report";

export default async function EvaluationReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <EvaluationReport runId={runId} />;
}
