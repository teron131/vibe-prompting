/** Opens one context inside the shared session-agnostic context workspace. */

import { ContextStudio } from "@/components/contexts/studio";

export default async function ContextDetailPage({
  params,
}: {
  params: Promise<{ contextId: string }>;
}) {
  const { contextId } = await params;
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ContextStudio initialContextId={contextId} />
    </main>
  );
}
