/** Routes the evaluation workspace entry to scalable result inspection. */

import { redirect } from "next/navigation";

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string | string[] }>;
}) {
  const { context } = await searchParams;
  redirect(
    typeof context === "string"
      ? `/evaluations/run?context=${encodeURIComponent(context)}`
      : "/evaluations/results",
  );
}
