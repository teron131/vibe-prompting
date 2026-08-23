/** Composes navigation, history, appearance controls, and the close affordance inside the workspace drawer. */

"use client";

import { FlaskConical, LogOut, MessageSquareText, Settings, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RefObject } from "react";

import { AppIcon } from "@/components/app-icon";
import { cn } from "@/components/ui/utils";

import { ChatHistory } from "./chat-history";
import { SidebarThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", icon: MessageSquareText, label: "Chat" },
  { href: "/prompts", icon: Sparkles, label: "Prompts" },
  { href: "/evaluations", icon: FlaskConical, label: "Evaluations" },
];
const footerActionClassName =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AppSidebar({
  closeButtonRef,
  currentUser,
  onClose,
}: {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  currentUser: { email: string; name: string | null };
  onClose(): void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-(--header-height) items-center justify-between border-b border-sidebar-border px-2">
        <Link
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight"
          href="/"
        >
          <AppIcon className="size-5" />
          <span className="truncate">Vibe Prompting</span>
        </Link>
        <button
          aria-label="Close sidebar"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent"
          onClick={onClose}
          ref={closeButtonRef}
          title="Close sidebar"
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <nav aria-label="Primary" className="space-y-1 p-1.5">
        {links.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/"
              ? pathname === "/" || pathname.startsWith("/chat/")
              : pathname.startsWith(href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium transition-colors hover:bg-sidebar-accent",
                active && "bg-foreground text-background hover:bg-foreground hover:text-background",
              )}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mx-1.5 border-t border-sidebar-border" />
      <div className="flex min-h-0 flex-1 flex-col p-1.5">
        <div className="min-h-0 flex-1">
          <ChatHistory />
        </div>
      </div>
      <div className="border-t border-sidebar-border p-1.5">
        <div className="flex min-w-0 items-center gap-2 rounded-lg py-1 pl-[7px]">
          <div
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background"
          >
            {userInitial(currentUser)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{currentUser.name ?? currentUser.email}</p>
            {currentUser.name ? (
              <p className="truncate text-[10px] text-muted-foreground">{currentUser.email}</p>
            ) : null}
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              aria-label="Sign out"
              className={footerActionClassName}
              title="Sign out"
              type="submit"
            >
              <LogOut aria-hidden="true" className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-sidebar-border p-1.5">
        <SidebarThemeToggle />
        <Link
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          aria-label="Settings"
          className={cn(
            footerActionClassName,
            pathname.startsWith("/settings") &&
              "bg-foreground text-background hover:bg-foreground hover:text-background",
          )}
          href="/settings"
          title="Settings"
        >
          <Settings aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function userInitial(user: { email: string; name: string | null }): string {
  return (user.name?.trim() || user.email).slice(0, 1).toUpperCase();
}
