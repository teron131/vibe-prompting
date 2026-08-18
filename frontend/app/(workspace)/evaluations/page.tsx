/** Presents prompt-bound evaluation configuration and recent durable attempts. */

import { FlaskConical } from "lucide-react";

import { EvaluationWorkbench } from "@/components/evaluations/evaluation-workbench";
import { FeaturePageHeader } from "@/components/shell/header";

export default function EvaluationsPage() {
  return (
    <main className="min-h-screen">
      <FeaturePageHeader icon={FlaskConical} title="Evaluations" />
      <EvaluationWorkbench />
    </main>
  );
}
