/** Presents one current prompt editor and its immutable revision evidence. */

import { Sparkles } from "lucide-react";

import { PromptEditor } from "@/components/prompts/prompt-editor";
import { FeaturePageHeader } from "@/components/shell/header";

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ promptId: string }>;
}) {
  const { promptId } = await params;
  return (
    <main className="min-h-screen">
      <FeaturePageHeader icon={Sparkles} title="Prompt detail" />
      <PromptEditor promptId={promptId} />
    </main>
  );
}
