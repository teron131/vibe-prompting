/** Gives native details menus expected popover dismissal on outside pointer interaction or Escape. */

"use client";

import type { RefObject } from "react";
import { useEffect } from "react";

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector<HTMLElement>("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}
