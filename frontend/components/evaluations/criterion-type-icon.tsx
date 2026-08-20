/** Keeps criterion-type symbols consistent across evaluation setup and review surfaces. */

import { Hash, PencilLine, Tags, ToggleLeft, Type } from "lucide-react";

import { cn } from "@/components/ui/utils";
import type { Criterion } from "@/contracts/evaluations";

const icons = {
  boolean: ToggleLeft,
  categorical: Tags,
  correction: PencilLine,
  numeric: Hash,
  text: Type,
} satisfies Record<Criterion["type"], typeof ToggleLeft>;

export function CriterionTypeIcon({
  className,
  type,
}: {
  className?: string;
  type: Criterion["type"];
}) {
  const Icon = icons[type];
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />;
}
