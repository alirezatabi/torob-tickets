"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { SpinningEarth } from "@/components/ui/spinning-earth";

/**
 * The homepage hero: one sentence, one field, and a planet that is actually turning.
 *
 * The motion here is *orientation*, not decoration: the Earth settles in from the left, the
 * headline rises with a soft blur, the search card arrives last so the eye lands on it. Every
 * animation is a transform/opacity pair (cheap on the compositor), runs once, and collapses to a
 * plain static page when the visitor prefers reduced motion.
 */
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

  const rise = (delay: number) =>
    reduce
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 14, filter: "blur(6px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 pb-4 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
      <div className="min-w-0">
        <motion.p
          {...rise(0)}
          className="mx-auto inline-flex items-center gap-2 rounded-full border border-teal-600/15 bg-white/70 px-3 py-1 text-[0.66rem] font-semibold text-teal-800 shadow-sm backdrop-blur lg:mx-0"
        >
          <span className="dot text-teal-500" aria-hidden="true" />
          {badge}
        </motion.p>

        <motion.h1
          {...rise(0.08)}
          className="mt-4 text-[2rem] font-black leading-[1.25] text-ink-900 sm:text-[2.9rem] sm:leading-[1.15]"
        >
          قیمت پرواز را <span className="brand-gradient-text">مقایسه</span> کنید
        </motion.h1>

        <motion.p {...rise(0.16)} className="mt-3 max-w-md text-[0.92rem] leading-7 text-ink-500">
          چند منبع، یک رتبه‌بندی شفاف، بدون قیمت ساختگی. مسیر را انتخاب کنید؛ بقیه‌اش با ما.
        </motion.p>

        <motion.div {...rise(0.24)} className="mt-7">
          {children}
        </motion.div>
      </div>

      {/* The planet: hidden from assistive tech (the hero text carries the meaning), and gone on
          small screens where it would only push the form down. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none relative hidden lg:block"
        initial={reduce ? false : { opacity: 0, scale: 0.82, rotate: -18 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 1.4, ease: EASE }}
      >
        <div className="absolute inset-6 -z-10 rounded-full bg-teal-400/10 blur-3xl" />
        <SpinningEarth className="animate-float" />
      </motion.div>
    </div>
  );
}
