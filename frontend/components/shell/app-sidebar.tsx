/** Composes navigation, history, appearance controls, and the close affordance inside the workspace drawer. */

"use client";

import { FlaskConical, MessageSquareText, Sparkles, X } from "lucide-react";
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

export function AppSidebar({
  closeButtonRef,
  onClose,
}: {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
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
        <SidebarThemeToggle />
      </div>
    </div>
  );
}
