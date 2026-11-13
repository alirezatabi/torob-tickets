"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { GlobeScene } from "@/components/ui/globe-scene";

/** The search card now occupies the hero's left column, opposite the animated Earth. */
const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden bg-[#030811] text-[#eef5ff]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_72%_42%,rgba(11,71,125,0.34)_0%,rgba(3,15,31,0.52)_38%,transparent_72%)]"
      />
      <div className="relative mx-auto grid max-w-[1500px] items-center gap-0 px-0 lg:min-h-[660px] lg:grid-cols-[minmax(25rem,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative z-10 order-1 px-4 pt-7 sm:px-6 sm:pt-10 lg:order-none lg:py-12"
        >
          <div className="mx-auto max-w-2xl">{children}</div>
        </motion.div>

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
    </section>
  );
}
