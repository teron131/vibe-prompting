/** Keeps public identity and invitation routes outside the operational workspace navigation shell. */

import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
