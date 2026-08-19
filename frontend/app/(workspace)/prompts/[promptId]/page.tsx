/** Opens one prompt inside the shared session-agnostic prompt workspace. */

import { Sparkles } from "lucide-react";

import { PromptChatLink, PromptStudio } from "@/components/prompts/studio";
import { FeaturePageHeader } from "@/components/shell/header";

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ promptId: string }>;
}) {
  const { promptId } = await params;
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden">
      <FeaturePageHeader icon={Sparkles} rightContent={<PromptChatLink />} title="Prompts" />
      <PromptStudio initialPromptId={promptId} />
    </main>
  );
}
