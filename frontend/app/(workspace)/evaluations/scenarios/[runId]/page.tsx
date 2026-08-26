/** Presents one durable Scenario and its linked evaluations inside the Evaluation workspace. */

import { ScenarioReport } from "@/components/evaluations/results/scenario-report";

export default async function ScenarioReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ScenarioReport runId={runId} />;
}
