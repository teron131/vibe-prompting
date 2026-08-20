/** Routes the evaluation workspace entry to scalable result inspection. */

import { redirect } from "next/navigation";

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string | string[] }>;
}) {
  const { prompt } = await searchParams;
  redirect(
    typeof prompt === "string"
      ? `/evaluations/run?prompt=${encodeURIComponent(prompt)}`
      : "/evaluations/results",
  );
}
