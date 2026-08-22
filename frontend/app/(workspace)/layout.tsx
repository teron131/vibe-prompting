/** Wraps all operational pages in the shared responsive navigation shell. */

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentSessionUser } from "@/auth/session";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");
  if (user.membershipStatus !== "active") redirect("/access");
  return (
    <WorkspaceShell currentUser={{ email: user.email, name: user.name }}>{children}</WorkspaceShell>
  );
}
