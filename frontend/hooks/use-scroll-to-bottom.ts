/** Keeps a conversation pinned to new content while respecting a reader who intentionally scrolled upward. */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollToBottom(dependency: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const pinned = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinnedRef.current = pinned;
    setIsAtBottom(pinned);
  }, []);
  const scrollToBottom = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    pinnedRef.current = true;
    setIsAtBottom(true);
    element.scrollTo({ behavior: "smooth", top: element.scrollHeight });
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (element && pinnedRef.current) element.scrollTo({ top: element.scrollHeight });
  }, [dependency]);

  return { containerRef, isAtBottom, onScroll, scrollToBottom };
}
