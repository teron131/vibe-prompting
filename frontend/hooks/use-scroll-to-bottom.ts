/** Keeps a conversation pinned to new content while respecting a reader who intentionally scrolled upward. */

"use client";

import { useCallback, useEffect, useRef } from "react";

export function useScrollToBottom(dependency: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (element && pinnedRef.current) element.scrollTo({ top: element.scrollHeight });
  }, [dependency]);

  return { containerRef, onScroll };
}
