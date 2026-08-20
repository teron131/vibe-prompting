/** Gives workspace feature pages a consistent mobile navigation affordance and compact title row. */

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { SidebarToggle } from "./toggle";

export function FeaturePageHeader({
  href,
  icon,
  rightContent,
  title,
}: {
  href?: string;
  icon: LucideIcon | ReactElement;
  rightContent?: ReactNode;
  title: string;
}) {
  return (
    <header className="flex h-(--header-height) items-center justify-between border-b px-3 sm:px-5">
      <div className="flex shrink-0 items-center gap-2">
        <SidebarToggle />
        {href ? (
          <Link className="flex min-w-0 items-center gap-2 hover:text-muted-foreground" href={href}>
            <HeaderIcon icon={icon} />
            <h1 className="truncate text-sm font-semibold">{title}</h1>
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <HeaderIcon icon={icon} />
            <h1 className="truncate text-sm font-semibold">{title}</h1>
          </div>
        )}
      </div>
      {rightContent}
    </header>
  );
}

function HeaderIcon({ icon }: { icon: LucideIcon | ReactElement }) {
  if (isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon aria-hidden="true" className="size-[18px] shrink-0" />;
}
