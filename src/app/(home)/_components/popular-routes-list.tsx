"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The card grid of «پرفروش‌های هفته», animated as a group when it scrolls into view.
 *
 * Only the *entrance* is client-side: the cards themselves are rendered on the server (with their
 * real prices and links) and handed in as children, so the strip is complete HTML before this
 * component ever hydrates. Motion here is `whileInView` with a stagger, once, and nothing at all
 * when the visitor prefers reduced motion.
 */
export function PopularRoutesList({ children }: { children: React.ReactNode[] }) {
  const reduce = useReducedMotion();

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="popular-routes">
      {children.map((child, index) => (
        <motion.li
          key={index}
          className="list-none"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25, margin: "0px 0px -40px 0px" }}
          transition={{ duration: 0.45, delay: reduce ? 0 : index * 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          {child}
        </motion.li>
      ))}
    </ul>
  );
}
