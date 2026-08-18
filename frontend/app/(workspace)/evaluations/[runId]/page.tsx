/** Presents one durable prompt-bound evaluation report and its exact immutable artifact. */

import { FlaskConical } from "lucide-react";

import { EvaluationReport } from "@/components/evaluations/evaluation-report";
import { FeaturePageHeader } from "@/components/shell/header";

export default async function EvaluationReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <main className="min-h-screen">
      <FeaturePageHeader icon={FlaskConical} title="Evaluation report" />
      <EvaluationReport runId={runId} />
    </main>
  );
}
