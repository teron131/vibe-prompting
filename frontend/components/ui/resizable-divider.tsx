/** Owns accessible pointer and keyboard interaction for adjustable vertical workspace dividers. */

"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "./utils";

type ResizableDividerProps = {
  ariaLabel: string;
  className?: string;
  defaultValueText: string;
  maxSize: number | (() => number);
  minSize: number;
  onDraggingChange?(dragging: boolean): void;
  onSizeChange(size: number | undefined): void;
  panelRef: RefObject<HTMLElement | null>;
  panelSide?: "left" | "right";
  size?: number;
  step?: number;
};

export function ResizableDivider({
  ariaLabel,
  className,
  defaultValueText,
  maxSize,
  minSize,
  onDraggingChange,
  onSizeChange,
  panelRef,
  panelSide = "left",
  size,
  step = 24,
}: ResizableDividerProps) {
  const [dragging, setDragging] = useState(false);
  const dragOriginRef = useRef<
    { pointerId: number; startSize: number; startX: number } | undefined
  >(undefined);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const maximumSize = () => Math.max(minSize, typeof maxSize === "function" ? maxSize() : maxSize);
  const boundedSize = (value: number) => Math.min(maximumSize(), Math.max(minSize, value));
  const currentSize = () => panelRef.current?.getBoundingClientRect().width ?? size ?? minSize;
  const resizeBy = (delta: number) => {
    const direction = panelSide === "left" ? 1 : -1;
    onSizeChange(boundedSize(currentSize() + delta * direction));
  };
  const finishResize = (pointerId: number) => {
    if (dragOriginRef.current?.pointerId !== pointerId) return;
    dragOriginRef.current = undefined;
    setDragging(false);
    onDraggingChange?.(false);
  };

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={Math.round(maximumSize())}
      aria-valuemin={minSize}
      aria-valuenow={size === undefined ? undefined : Math.round(size)}
      aria-valuetext={size === undefined ? defaultValueText : `${Math.round(size)} pixels`}
      className={cn("group relative z-10 w-px shrink-0 cursor-col-resize outline-none", className)}
      onDoubleClick={() => onSizeChange(undefined)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          resizeBy(-step);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          resizeBy(step);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSizeChange(minSize);
        } else if (event.key === "End") {
          event.preventDefault();
          onSizeChange(maximumSize());
        }
      }}
      onLostPointerCapture={(event) => finishResize(event.pointerId)}
      onPointerCancel={(event) => finishResize(event.pointerId)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !panelRef.current) return;
        event.preventDefault();
        dragOriginRef.current = {
          pointerId: event.pointerId,
          startSize: panelRef.current.getBoundingClientRect().width,
          startX: event.clientX,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onDraggingChange?.(true);
      }}
      onPointerMove={(event) => {
        const origin = dragOriginRef.current;
        if (!origin || origin.pointerId !== event.pointerId) return;
        const direction = panelSide === "left" ? 1 : -1;
        onSizeChange(boundedSize(origin.startSize + (event.clientX - origin.startX) * direction));
      }}
      onPointerUp={(event) => {
        if (dragOriginRef.current?.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        finishResize(event.pointerId);
      }}
      role="separator"
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
    >
      <span className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 touch-none">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/50 group-focus-visible:w-0.5 group-focus-visible:bg-ring" />
      </span>
    </div>
  );
}
