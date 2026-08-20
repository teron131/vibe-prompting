/** Presents the session-agnostic prompt workspace inside the application shell. */

import { PromptStudio } from "@/components/prompts/studio";

export default function PromptsPage() {
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden">
      <PromptStudio />
    </main>
  );
}
