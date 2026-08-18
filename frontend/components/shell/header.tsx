/** Gives workspace feature pages a consistent mobile navigation affordance and compact title row. */

import type { LucideIcon } from "lucide-react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { SidebarToggle } from "./toggle";

export function FeaturePageHeader({
  icon,
  rightContent,
  title,
}: {
  icon: LucideIcon | ReactElement;
  rightContent?: ReactNode;
  title: string;
}) {
  return (
    <header className="flex h-(--header-height) items-center justify-between border-b px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarToggle />
        <HeaderIcon icon={icon} />
        <h1 className="truncate text-sm font-semibold">{title}</h1>
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
