/** Owns the persistent desktop workspace sidebar and its narrow-screen overlay behavior. */

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
  sidebarOpen: boolean;
  toggleSidebar(): void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);
const SIDEBAR_MEDIA_QUERY = "(min-width: 768px)";
const SIDEBAR_OPEN_STORAGE_KEY = "vibe-prompting:workspace-sidebar-open";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarDocked, setSidebarDocked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(pathname);
  const returnFocusRef = useRef<HTMLElement>(null);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    if (sidebarDocked) persistSidebarOpenPreference(false);
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]");
      target?.focus();
    });
  }, [sidebarDocked]);
  const openSidebar = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSidebarOpen(true);
    if (sidebarDocked) persistSidebarOpenPreference(true);
  }, [sidebarDocked]);
  const toggleSidebar = useCallback(
    () => (sidebarOpen ? closeSidebar() : openSidebar()),
    [closeSidebar, openSidebar, sidebarOpen],
  );
  const context = useMemo(
    () => ({
      sidebarOpen,
      toggleSidebar,
    }),
    [sidebarOpen, toggleSidebar],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(SIDEBAR_MEDIA_QUERY);
    const syncSidebar = () => {
      setSidebarDocked(mediaQuery.matches);
      setSidebarOpen(mediaQuery.matches ? (readSidebarOpenPreference() ?? true) : false);
    };
    syncSidebar();
    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (!sidebarOpen || sidebarDocked) return;
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")?.focus();
    });
  }, [pathname, sidebarDocked, sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen || sidebarDocked) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSidebar, sidebarDocked, sidebarOpen]);

  return (
    <SidebarContext.Provider value={context}>
      <div className="min-h-dvh bg-background">
        <button
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-30 bg-black/20 transition-opacity md:hidden",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={closeSidebar}
          tabIndex={-1}
          type="button"
        />
        <aside
          aria-label="Workspace navigation"
          aria-hidden={!sidebarOpen}
          aria-modal={sidebarDocked ? undefined : true}
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          inert={!sidebarOpen}
          role={sidebarDocked ? undefined : "dialog"}
        >
          <AppSidebar closeButtonRef={closeButtonRef} onClose={closeSidebar} />
        </aside>
        <div
          className={cn("min-h-dvh transition-[padding] duration-200", sidebarOpen && "md:pl-64")}
          inert={sidebarOpen && !sidebarDocked}
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

function readSidebarOpenPreference(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {}
  return undefined;
}

function persistSidebarOpenPreference(open: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open));
  } catch {}
}
