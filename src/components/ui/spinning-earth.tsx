"use client";

import { useEffect, useRef, useState } from "react";

import landData from "@/lib/map/land-1deg.json";
import { projectLand, type LandRing } from "@/lib/globe-view";
import { cn } from "@/lib/cn";

/**
 * The planet behind the homepage hero: a real orthographic Earth, turning slowly.
 *
 * It is not a video or an image — the coastline is projected every frame from the same Natural
 * Earth data the ticket globe uses (thinned for the client in `scripts/build-land.mjs`), so the
 * horizon, the limb and the far side are genuinely computed. That keeps the claim on the page
 * honest: the thing being animated *is* the map engine, not a decoration pretending to be one.
 *
 * Small, calm, and skippable by design: it pauses when the tab is hidden, pauses on hover, and
 * draws a single static frame when the visitor prefers reduced motion.
 */

const LANDS = (landData as unknown as { rings: LandRing[] }).rings;
const SIZE = 320;
const RADIUS = 150;
const CX = SIZE / 2;
const CY = SIZE / 2;
/** Degrees per second. A full turn takes two minutes: visible, never distracting. */
const SPEED = 3;
/** Where the journey starts: the Persian plateau, so the first frame is "home". */
const START_YAW = 52;

export function SpinningEarth({ className }: { className?: string }) {
  const [yaw, setYaw] = useState(START_YAW);
  /**
   * The server can project the first frame, but not the 9k-vertex path data: doing so put ~130 kB
   * of coordinates into the homepage HTML. So the first frame is drawn as soon as the component
   * hydrates (immediately, not on the first animation tick), and the sphere starts turning from
   * there. `mounted` only guards the (empty) pre-hydration paint.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const frame = useRef<number | null>(null);
  const paused = useRef(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(now - last, 120);
      last = now;
      if (!paused.current && document.visibilityState === "visible") {
        setYaw((value) => (value + (delta / 1000) * SPEED) % 360);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const gradientId = "earth-hero-gradient";
  const rimId = "earth-hero-rim";
  const clipId = "earth-hero-clip";

  // One path per visible run of land. React only re-attributes the paths that exist, so the
  // frame cost stays close to the (unavoidable) projection maths.
  const paths = mounted ? projectLand(LANDS, { yaw, pitch: 20, radius: RADIUS, cx: CX, cy: CY }) : [];

  return (
    <div
      className={cn("relative aspect-square w-full select-none", className)}
      data-testid="spinning-earth"
      aria-hidden="true"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        <defs>
          <radialGradient id={gradientId} cx="34%" cy="26%" r="82%">
            <stop offset="0%" stopColor="#f6fdfc" />
            <stop offset="42%" stopColor="#dff2ef" />
            <stop offset="78%" stopColor="#bcdcd7" />
            <stop offset="100%" stopColor="#8fbfb8" />
          </radialGradient>
          <radialGradient id={rimId} cx="32%" cy="24%" r="88%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#04231f" stopOpacity="0.3" />
          </radialGradient>
          <clipPath id={clipId}>
            <circle cx={CX} cy={CY} r={RADIUS} />
          </clipPath>
        </defs>

        <circle cx={CX} cy={CY} r={RADIUS} fill={`url(#${gradientId})`} />
        <g clipPath={`url(#${clipId})`}>
          {mounted ? null : <circle cx={CX} cy={CY} r={RADIUS} fill="#8fc4bc" fillOpacity="0.35" />}
          {paths.map((path, index) => (
            <path key={index} d={path} fill="#5fa8a0" fillOpacity="0.92" />
          ))}
        </g>
        <circle cx={CX} cy={CY} r={RADIUS} fill={`url(#${rimId})`} />
        <circle cx={CX} cy={CY} r={RADIUS} fill="none" stroke="#0d6b60" strokeOpacity="0.25" />
      </svg>
    </div>
  );
}
