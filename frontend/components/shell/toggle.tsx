/** Toggles the persistent workspace sidebar from feature-page headers. */

"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

import { useWorkspaceSidebar } from "./workspace-shell";

export function SidebarToggle({ className }: { className?: string }) {
  const { sidebarOpen, toggleSidebar } = useWorkspaceSidebar();
  const label = sidebarOpen ? "Close sidebar" : "Open sidebar";

  return (
    <Button
      aria-expanded={sidebarOpen}
      aria-label={label}
      className={cn("size-8 text-muted-foreground", className)}
      data-sidebar-toggle
      onClick={toggleSidebar}
      size="icon"
      title={label}
      variant="ghost"
    >
      {sidebarOpen ? (
        <PanelLeftClose aria-hidden="true" className="size-4" />
      ) : (
        <PanelLeftOpen aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}
