"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { GlobeScene } from "@/components/ui/globe-scene";

/** The homepage's Earth/network presentation, with the flight search kept immediately in reach. */
const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero({
  children,
  badge,
}: {
  children: ReactNode;
  /** Real counts from the catalogue — the hero never hard-codes a claim. */
  badge: string;
}) {
  const reduce = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden bg-[#030811] text-[#eef5ff]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_72%_42%,rgba(11,71,125,0.34)_0%,rgba(3,15,31,0.52)_38%,transparent_72%)]"
      />
      <div className="relative mx-auto grid max-w-[1500px] items-center gap-0 px-0 lg:min-h-[660px] lg:grid-cols-[minmax(25rem,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div className="relative z-10 order-1 px-5 pt-10 text-center sm:pt-14 lg:order-none lg:pl-8 lg:pr-0 lg:pt-0 lg:text-left">
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE }}
            dir="ltr"
            className="text-[2.4rem] font-semibold tracking-[-0.055em] sm:text-5xl lg:text-[3.5rem]"
          >
            Region: Earth
          </motion.h1>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: EASE }}
            dir="ltr"
            className="mx-auto mt-3 max-w-xl text-sm font-medium tracking-tight text-[#aabbd0] sm:text-base lg:mx-0"
          >
            One smart network for every journey — routes, fares, and places, close to you.
          </motion.p>
          <p className="mx-auto mt-5 inline-flex max-w-[calc(100%-2rem)] items-center rounded-full border border-sky-300/15 bg-sky-200/[0.045] px-3 py-1 text-[0.65rem] font-medium text-[#91a9c5] lg:mx-0">
            {badge}
          </p>
        </div>

        {/* A restrained, vector-lit globe: blue atmosphere, city glints, and a few orbit paths. */}
        <div className="relative order-2 h-[min(520px,120vw)] overflow-hidden sm:h-[600px] lg:order-none lg:h-[660px] lg:overflow-visible">
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 w-[min(720px,125vw)] -translate-x-1/2 lg:left-auto lg:right-[-48px] lg:top-[-68px] lg:w-[900px] lg:max-w-none lg:translate-x-0"
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.12, ease: EASE }}
          >
            <GlobeScene planet size={900} period={150} className="mx-auto w-full max-w-[900px]" />
          </motion.div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 pb-9 pt-2 sm:px-6 lg:pt-0">
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[#02060c]/70"
      />
    </section>
  );
}
