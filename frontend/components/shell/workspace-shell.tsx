/** Owns the transient workspace drawer while leaving route content and feature state to descendants. */

"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/components/ui/utils";

import { AppSidebar } from "./app-sidebar";

type SidebarContextValue = {
  openSidebar(): void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(pathname);
  const returnFocusRef = useRef<HTMLElement>(null);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    });
  }, []);
  const openSidebar = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSidebarOpen(true);
  }, []);
  const context = useMemo(
    () => ({
      openSidebar,
    }),
    [openSidebar],
  );

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (!sidebarOpen) return;
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")?.focus();
    });
  }, [pathname, sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSidebar, sidebarOpen]);

  return (
    <SidebarContext.Provider value={context}>
      <div className="min-h-screen bg-background">
        <button
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-30 bg-black/20 transition-opacity",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={closeSidebar}
          tabIndex={-1}
          type="button"
        />
        <aside
          aria-label="Workspace navigation"
          aria-hidden={!sidebarOpen}
          aria-modal="true"
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          inert={!sidebarOpen}
          role="dialog"
        >
          <AppSidebar closeButtonRef={closeButtonRef} onClose={closeSidebar} />
        </aside>
        <div className="min-h-screen" inert={sidebarOpen}>
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
