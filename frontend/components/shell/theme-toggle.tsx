/** Selects the system, light, or dark appearance from a compact sidebar pill. */

"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/components/ui/utils";

const options = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const;

export function SidebarThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const activeTheme = mounted ? theme : undefined;

  useEffect(() => setMounted(true), []);

  return (
    <div
      aria-label="Theme"
      className={cn(
        "flex w-fit gap-0.5 rounded-full border border-sidebar-border bg-sidebar-accent/50 p-1",
        collapsed && "md:mx-auto md:flex-col",
      )}
      role="group"
    >
      {options.map(({ icon: Icon, label, value }) => {
        const active = activeTheme === value;
        return (
          <button
            aria-label={`${label} theme`}
            aria-pressed={active}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default",
              active &&
                "bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background",
            )}
            disabled={!mounted}
            key={value}
            onClick={() => setTheme(value)}
            title={`${label} theme`}
            type="button"
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
