"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { GlobeScene } from "@/components/ui/globe-scene";

/** Persian flight promise alongside the globe; the search surface spans the hero below it. */
const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero({
  children,
  badge,
}: {
  children: ReactNode;
  badge: string;
}) {
  const reduce = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden bg-[#030811] text-[#eef5ff] lg:h-[100svh]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_72%_42%,rgba(11,71,125,0.34)_0%,rgba(3,15,31,0.52)_38%,transparent_72%)]"
      />
      <div className="relative mx-auto max-w-[1500px] px-0 pt-[4.75rem] sm:pt-20 lg:h-full lg:px-8 lg:pt-0">
        <div dir="rtl" className="grid items-center gap-0 lg:h-full lg:grid-cols-[minmax(0,1.2fr)_minmax(25rem,0.8fr)] lg:items-start lg:pt-24">
          <div dir="rtl" className="relative z-10 order-1 px-5 pt-3 text-center sm:px-8 lg:order-none lg:mt-10 lg:pl-8 lg:pr-10 lg:text-right">
            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: EASE }}
              className="text-[1.95rem] font-black leading-[1.3] tracking-tight sm:text-[2.6rem]"
            >
              قیمت پرواز را <span className="bg-gradient-to-l from-[#73d0ff] via-[#49a9f1] to-[#e9c16e] bg-clip-text text-transparent">مقایسه</span> کنید
            </motion.h1>
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.08, ease: EASE }}
              className="mx-auto mt-3 max-w-lg text-sm leading-7 text-[#b4c4d8] sm:text-base lg:mx-0"
            >
              چند منبع، یک رتبه‌بندی شفاف، بدون قیمت ساختگی. مسیر را انتخاب کنید؛ بقیه‌اش با ما.
            </motion.p>
            <p className="mx-auto mt-4 inline-flex max-w-full items-center rounded-full border border-sky-300/15 bg-sky-200/[0.045] px-3 py-1 text-[0.65rem] font-medium text-[#91a9c5] lg:mx-0">
              {badge}
            </p>
          </div>

          {/* The search card below intentionally overlaps the lower edge of the illuminated globe. */}
          <div className="relative order-2 h-[min(390px,96vw)] overflow-hidden sm:h-[480px] lg:order-none lg:h-full lg:overflow-visible">
            <motion.div
              aria-hidden="true"
              className="pointer-events-auto absolute left-1/2 top-0 w-[min(660px,120vw)] -translate-x-1/2 lg:left-[-80px] lg:right-auto lg:top-[-70px] lg:w-[900px] lg:max-w-none lg:translate-x-0"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 1.1, delay: 0.12, ease: EASE }}
            >
              <GlobeScene planet size={900} period={150} className="mx-auto w-full max-w-[900px]" />
            </motion.div>
          </div>
        </div>

        <div dir="rtl" className="relative z-20 mx-auto -mt-5 max-w-5xl px-4 pb-9 sm:-mt-10 sm:px-6 lg:absolute lg:bottom-4 lg:right-12 lg:mt-0 lg:w-[min(54%,760px)] lg:max-w-none lg:px-0 lg:pb-2">
          {children}
        </div>
      </div>
    </section>
  );
}
