/** Gives authentication tasks one quiet, brand-consistent utility surface without marketing content. */

import type { ReactNode } from "react";

import { AppIcon } from "@/components/app-icon";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-foreground">
      <section aria-label="Vibe Prompting access" className="w-full max-w-sm">
        <header className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em]">
          <AppIcon className="size-7" />
          <span>Vibe Prompting</span>
        </header>
        <div className="mt-8 border-t pt-7">{children}</div>
      </section>
    </main>
  );
}
