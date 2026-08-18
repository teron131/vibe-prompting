/** Presents the durable prompt library and creation workflow inside the workspace shell. */

import { Sparkles } from "lucide-react";

import { PromptList } from "@/components/prompts/prompt-list";
import { FeaturePageHeader } from "@/components/shell/header";

export default function PromptsPage() {
  return (
    <main className="min-h-screen">
      <FeaturePageHeader icon={Sparkles} title="Prompts" />
      <PromptList />
    </main>
  );
}
