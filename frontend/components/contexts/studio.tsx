/** Composes the session-agnostic context workspace as a file navigator and selected context workbench. */

"use client";

import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ContextEditor } from "@/components/contexts/editor";
import { ContextList } from "@/components/contexts/list";
import { FeaturePageHeader } from "@/components/shell/header";
import { WorkspaceHomeLink } from "@/components/shell/home-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type { ContextSearchPassage, ContextSummary } from "@/contracts/contexts";

export function ContextStudio({ initialContextId }: { initialContextId?: string }) {
  const [activeContextId, setActiveContextId] = useState(initialContextId);
  const [creating, setCreating] = useState(false);
  const [dirtyDraft, setDirtyDraft] = useState(false);
  const [selectedPassage, setSelectedPassage] = useState<ContextSearchPassage>();

  useEffect(() => {
    function restoreSelection() {
      const nextContextId = readContextId(window.location.pathname);
      if (
        nextContextId !== activeContextId &&
        dirtyDraft &&
        !window.confirm("Discard the unsaved context draft?")
      ) {
        window.history.pushState(
          null,
          "",
          activeContextId ? `/contexts/${activeContextId}` : "/contexts",
        );
        return;
      }
      setActiveContextId(nextContextId);
      setDirtyDraft(false);
      setSelectedPassage(undefined);
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, [activeContextId, dirtyDraft]);

  function selectContext(context: ContextSummary, passage?: ContextSearchPassage) {
    if (
      context.id !== activeContextId &&
      dirtyDraft &&
      !window.confirm("Discard the unsaved context draft?")
    )
      return;
    setActiveContextId(context.id);
    if (context.id !== activeContextId) setDirtyDraft(false);
    setSelectedPassage(passage ? { ...passage } : undefined);
    window.history.pushState(null, "", `/contexts/${context.id}`);
  }

  function closeContext() {
    if (dirtyDraft && !window.confirm("Discard the unsaved context draft?")) return false;
    clearSelection();
    window.history.pushState(null, "", "/contexts");
    return true;
  }

  function startCreating() {
    if (activeContextId && !closeContext()) return;
    setCreating(true);
  }

  function contextDeleted(contextId: string) {
    if (contextId !== activeContextId) return;
    clearSelection();
    window.history.pushState(null, "", "/contexts");
  }

  function clearSelection() {
    setActiveContextId(undefined);
    setDirtyDraft(false);
    setSelectedPassage(undefined);
  }

  return (
    <>
      <FeaturePageHeader
        href="/contexts"
        icon={Sparkles}
        rightContent={<WorkspaceHomeLink />}
        scope="Shared"
        title="Context Library"
      />
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "h-full min-h-0 w-full lg:block lg:w-auto",
            activeContextId && "hidden lg:block",
          )}
        >
          <ContextList
            activeContextId={activeContextId}
            creating={creating}
            onCreate={startCreating}
            onCreatingChange={setCreating}
            onContextDeleted={contextDeleted}
            onSelectContext={selectContext}
          />
        </div>
        <section
          aria-label="Selected context workspace"
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto",
            !activeContextId && "hidden lg:grid lg:place-items-center",
          )}
        >
          {activeContextId ? (
            <div className="page-gutter mx-auto w-full max-w-6xl py-4 sm:py-6">
              <nav aria-label="Context navigation" className="mb-4 lg:hidden">
                <Button onClick={closeContext} size="sm" variant="ghost">
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  Contexts
                </Button>
              </nav>
              <ContextEditor
                key={activeContextId}
                onDirtyChange={setDirtyDraft}
                contextId={activeContextId}
                selectedPassage={selectedPassage}
              />
            </div>
          ) : (
            <div className="max-w-sm px-8 text-center">
              <FileText aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">Select a Context</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {
                  "Create prompts and skills, edit their instructions, and evaluate exact revisions in one workspace."
                }
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function readContextId(pathname: string): string | undefined {
  const match = pathname.match(/^\/contexts\/([^/]+)$/);
  return match?.[1];
}
