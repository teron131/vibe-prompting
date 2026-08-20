/** Frames every evaluation task with one shared feature header and scalable task navigation. */

import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

import { EvaluationNavigation } from "@/components/evaluations/navigation";
import { FeaturePageHeader } from "@/components/shell/header";
import { WorkspaceHomeLink } from "@/components/shell/home-link";

export default function EvaluationsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="@container min-h-screen">
      <FeaturePageHeader
        href="/evaluations"
        icon={FlaskConical}
        rightContent={
          <div className="flex min-w-0 flex-1 items-center">
            <EvaluationNavigation />
            <WorkspaceHomeLink />
          </div>
        }
        title="Evaluations"
      />
      {children}
    </main>
  );
}
