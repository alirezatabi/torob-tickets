"use client";

import { useEffect } from "react";

/**
 * On a narrow screen the strip is a horizontal swipe rail, so the selected chip can start
 * off-screen when the window has slid. This nudges the rail to the selected day once, on mount.
 *
 * Deliberately tiny and non-essential: with JavaScript off the chips are still reachable by
 * swiping, and the server-rendered HTML/URLs are unchanged. On `lg` the strip is a grid with no
 * horizontal overflow, so this is a no-op.
 */
export function DateStripScroller({ selectedDate }: { selectedDate: string }) {
  useEffect(() => {
    const rail = document.querySelector<HTMLElement>('[data-testid="date-strip"]');
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const chip = rail.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    if (!chip) return;
    // `scrollIntoView` respects RTL, so no manual scrollLeft arithmetic (which flips in RTL).
    chip.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedDate]);

  return null;
}
