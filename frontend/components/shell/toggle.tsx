/** Opens the transient workspace drawer from the page header. */

"use client";

import { PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

import { useWorkspaceSidebar } from "./workspace-shell";

export function SidebarToggle({ className }: { className?: string }) {
  const { openSidebar } = useWorkspaceSidebar();

  return (
    <Button
      aria-label="Open sidebar"
      className={cn("size-8 text-muted-foreground", className)}
      data-sidebar-toggle
      onClick={openSidebar}
      size="icon"
      title="Open sidebar"
      variant="ghost"
    >
      <PanelLeftOpen aria-hidden="true" className="size-4" />
    </Button>
  );
}
