/** Opens one prompt inside the shared session-agnostic prompt workspace. */

import { PromptStudio } from "@/components/prompts/studio";

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ promptId: string }>;
}) {
  const { promptId } = await params;
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden">
      <PromptStudio initialPromptId={promptId} />
    </main>
  );
}
