/** Composes prompt-workspace navigation, chat entry, history region, and appearance controls. */

"use client";

import { FlaskConical, MessageSquareText, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/utils";

import { ChatHistory } from "./chat-history";
import { SidebarThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", icon: MessageSquareText, label: "Chat" },
  { href: "/prompts", icon: Sparkles, label: "Prompts" },
  { href: "/evaluations", icon: FlaskConical, label: "Evaluations" },
];

export function AppSidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate(): void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-(--header-height) items-center justify-between border-b border-sidebar-border px-4",
          collapsed && "md:justify-center md:px-2",
        )}
      >
        <Link
          className={cn(
            "flex min-w-0 items-center gap-2 font-semibold tracking-tight",
            collapsed && "md:hidden",
          )}
          href="/"
          onClick={onNavigate}
        >
          <BrandIcon />
          <span className="truncate">Vibe Prompting</span>
        </Link>
        <Link
          aria-label="New chat"
          className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent"
          href="/"
          onClick={onNavigate}
          title="New chat"
        >
          <Plus aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <nav aria-label="Primary" className="space-y-1 p-2">
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
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent",
                active && "bg-foreground text-background hover:bg-foreground hover:text-background",
                collapsed && "md:mx-auto md:size-8 md:justify-center md:rounded-full md:px-0",
              )}
              href={href}
              key={href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className={cn("mx-2 border-t border-sidebar-border", collapsed && "md:hidden")} />
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <div className={cn("min-h-0 flex-1", collapsed && "md:hidden")}>
          <ChatHistory onNavigate={onNavigate} />
        </div>
      </div>
      <div className="border-t border-sidebar-border p-2">
        <SidebarThemeToggle collapsed={collapsed} />
      </div>
    </div>
  );
}

function BrandIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-6 shrink-0 text-black dark:text-white"
      viewBox="0 0 32 32"
    >
      <path d="M9 9h14v3H9zm0 5.5h10v3H9zm0 5.5h7v3H9z" fill="currentColor" />
      <circle cx="23" cy="22" fill="#a3e635" r="3" />
    </svg>
  );
}
