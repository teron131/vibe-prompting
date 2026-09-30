/** Presents the session-agnostic context workspace inside the application shell. */

import { ContextStudio } from "@/components/contexts/studio";

export default function ContextsPage() {
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ContextStudio />
    </main>
  );
}
