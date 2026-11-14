"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export interface FloatingPanelPosition {
  position: "fixed";
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Place a popover against its trigger in viewport coordinates, flipping it above when
 * there is not enough room below. Fixed positioning keeps menus clear of overflow clips
 * in cards, heroes, dialogs, and other scrolling containers.
 */
export function useFloatingPanel(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  options: { preferredWidth: number; minWidth?: number; preferredHeight: number },
): FloatingPanelPosition | null {
  const [position, setPosition] = useState<FloatingPanelPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const edge = 12;
      const gap = 8;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const minWidth = options.minWidth ?? options.preferredWidth;
      const width = Math.min(Math.max(rect.width, minWidth, options.preferredWidth), viewportWidth - edge * 2);
      const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge));
      const roomBelow = Math.max(0, viewportHeight - rect.bottom - gap - edge);
      const roomAbove = Math.max(0, rect.top - gap - edge);
      const shouldOpenAbove = roomBelow < Math.min(options.preferredHeight, 320) && roomAbove > roomBelow;
      const available = shouldOpenAbove ? roomAbove : roomBelow;
      const maxHeight = Math.max(80, Math.min(options.preferredHeight, available, viewportHeight - edge * 2));
      const rawTop = shouldOpenAbove ? rect.top - gap - maxHeight : rect.bottom + gap;
      const top = Math.max(edge, Math.min(rawTop, viewportHeight - maxHeight - edge));

      setPosition({ position: "fixed", top, left, width, maxHeight });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchorRef, open, options.minWidth, options.preferredHeight, options.preferredWidth]);

  return position;
}
