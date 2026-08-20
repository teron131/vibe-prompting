/** Composes the session-agnostic prompt workspace as a file navigator and selected prompt workbench. */

"use client";

import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { PromptEditor } from "@/components/prompts/editor";
import { PromptList } from "@/components/prompts/list";
import { FeaturePageHeader } from "@/components/shell/header";
import { WorkspaceHomeLink } from "@/components/shell/home-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type { PromptSearchPassage, PromptSummary } from "@/contracts/prompts";

export function PromptStudio({ initialPromptId }: { initialPromptId?: string }) {
  const [activePromptId, setActivePromptId] = useState(initialPromptId);
  const [creating, setCreating] = useState(false);
  const [dirtyDraft, setDirtyDraft] = useState(false);
  const [selectedPassage, setSelectedPassage] = useState<PromptSearchPassage>();

  useEffect(() => {
    function restoreSelection() {
      const nextPromptId = readPromptId(window.location.pathname);
      if (
        nextPromptId !== activePromptId &&
        dirtyDraft &&
        !window.confirm("Discard the unsaved prompt draft?")
      ) {
        window.history.pushState(
          null,
          "",
          activePromptId ? `/prompts/${activePromptId}` : "/prompts",
        );
        return;
      }
      setActivePromptId(nextPromptId);
      setDirtyDraft(false);
      setSelectedPassage(undefined);
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, [activePromptId, dirtyDraft]);

  function selectPrompt(prompt: PromptSummary, passage?: PromptSearchPassage) {
    if (
      prompt.id !== activePromptId &&
      dirtyDraft &&
      !window.confirm("Discard the unsaved prompt draft?")
    )
      return;
    setActivePromptId(prompt.id);
    if (prompt.id !== activePromptId) setDirtyDraft(false);
    setSelectedPassage(passage ? { ...passage } : undefined);
    window.history.pushState(null, "", `/prompts/${prompt.id}`);
  }

  function closePrompt() {
    if (dirtyDraft && !window.confirm("Discard the unsaved prompt draft?")) return false;
    clearSelection();
    window.history.pushState(null, "", "/prompts");
    return true;
  }

  function startCreating() {
    if (activePromptId && !closePrompt()) return;
    setCreating(true);
  }

  function promptDeleted(promptId: string) {
    if (promptId !== activePromptId) return;
    clearSelection();
    window.history.pushState(null, "", "/prompts");
  }

  function clearSelection() {
    setActivePromptId(undefined);
    setDirtyDraft(false);
    setSelectedPassage(undefined);
  }

  return (
    <>
      <FeaturePageHeader
        href="/prompts"
        icon={Sparkles}
        rightContent={<WorkspaceHomeLink />}
        title="Prompts"
      />
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "h-full min-h-0 w-full lg:block lg:w-auto",
            activePromptId && "hidden lg:block",
          )}
        >
          <PromptList
            activePromptId={activePromptId}
            creating={creating}
            onCreate={startCreating}
            onCreatingChange={setCreating}
            onPromptDeleted={promptDeleted}
            onSelectPrompt={selectPrompt}
          />
        </div>
        <section
          aria-label="Selected prompt workspace"
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto",
            !activePromptId && "hidden lg:grid lg:place-items-center",
          )}
        >
          {activePromptId ? (
            <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
              <nav aria-label="Prompt navigation" className="mb-4 lg:hidden">
                <Button onClick={closePrompt} size="sm" variant="ghost">
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  Prompts
                </Button>
              </nav>
              <PromptEditor
                key={activePromptId}
                onDirtyChange={setDirtyDraft}
                promptId={activePromptId}
                selectedPassage={selectedPassage}
              />
            </div>
          ) : (
            <div className="max-w-sm px-8 text-center">
              <FileText aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">Select a prompt file</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Inspect the latest content, edit it, or trace every change without leaving this
                workspace.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function readPromptId(pathname: string): string | undefined {
  const match = pathname.match(/^\/prompts\/([^/]+)$/);
  return match?.[1];
}
