/** Gives workspace feature pages a consistent mobile navigation affordance and compact title row. */

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { SidebarToggle } from "./toggle";

export function FeaturePageHeader({
  href,
  icon,
  rightContent,
  scope,
  title,
}: {
  href?: string;
  icon: LucideIcon | ReactElement;
  rightContent?: ReactNode;
  scope?: string;
  title: string;
}) {
  return (
    <header className="flex h-(--header-height) min-w-0 items-center justify-between gap-2 border-b px-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SidebarToggle />
        {href ? (
          <Link className="flex min-w-0 items-center gap-2 hover:text-muted-foreground" href={href}>
            <HeaderIcon icon={icon} />
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {scope ? <HeaderScope>{scope}</HeaderScope> : null}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <HeaderIcon icon={icon} />
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {scope ? <HeaderScope>{scope}</HeaderScope> : null}
          </div>
        )}
      </div>
      {rightContent}
    </header>
  );
}

function HeaderScope({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-[11px] font-normal text-muted-foreground">· {children}</span>
  );
}

function HeaderIcon({ icon }: { icon: LucideIcon | ReactElement }) {
  if (isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon aria-hidden="true" className="size-[18px] shrink-0" />;
}
