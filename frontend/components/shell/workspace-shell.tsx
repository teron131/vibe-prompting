/** Owns responsive sidebar visibility and persisted desktop width while leaving route content and feature state to descendants. */

"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { cn } from "@/components/ui/utils";

import { AppSidebar } from "./app-sidebar";

type SidebarContextValue = {
  closeMobile(): void;
  desktopCollapsed: boolean;
  toggleDesktop(): void;
  toggleMobile(): void;
};

const DESKTOP_COLLAPSED_KEY = "vibe-prompting-sidebar-collapsed";

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const context = useMemo(
    () => ({
      closeMobile: () => setMobileOpen(false),
      desktopCollapsed,
      toggleDesktop: () =>
        setDesktopCollapsed((collapsed) => {
          const nextCollapsed = !collapsed;
          window.localStorage.setItem(DESKTOP_COLLAPSED_KEY, String(nextCollapsed));
          return nextCollapsed;
        }),
      toggleMobile: () => setMobileOpen((open) => !open),
    }),
    [desktopCollapsed],
  );

  useEffect(() => {
    setDesktopCollapsed(window.localStorage.getItem(DESKTOP_COLLAPSED_KEY) === "true");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <SidebarContext.Provider value={context}>
      <div className="min-h-screen bg-background">
        <button
          aria-label="Close navigation"
          className={cn(
            "fixed inset-0 z-30 bg-black/35 transition-opacity md:hidden",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={context.closeMobile}
          type="button"
        />
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-72 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,width] md:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            desktopCollapsed ? "md:w-14" : "md:w-56",
          )}
        >
          <AppSidebar collapsed={desktopCollapsed} onNavigate={context.closeMobile} />
        </aside>
        <div
          className={cn(
            "min-h-screen transition-[padding-left]",
            desktopCollapsed ? "md:pl-14" : "md:pl-56",
          )}
        >
          {children}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

export function useWorkspaceSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("Sidebar controls must be rendered inside WorkspaceShell.");
  return context;
}
