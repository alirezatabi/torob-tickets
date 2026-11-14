"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plane, Sparkles } from "lucide-react";
import { Wordmark } from "./brand-mark";
import { DataModeBadge } from "./data-mode-badge";

export function SiteHeader() {
  const isHome = usePathname() === "/";

  return (
    <header
      className={
        isHome
          ? "absolute inset-x-0 top-0 z-30 border-b border-transparent bg-transparent text-white"
          : "glass sticky top-0 z-30 border-b border-ink-200/70"
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="ترب بلیت — صفحهٔ اصلی" className="rounded-xl">
          <Wordmark inverse={isHome} />
        </Link>

        <nav className="flex items-center gap-2" aria-label="ناوبری اصلی">
          <Link
            href="/#routes"
            className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:inline-flex ${isHome ? "text-slate-200 hover:bg-white/10 hover:text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}
          >
            <Plane className="size-3.5" aria-hidden="true" />
            مسیرها
          </Link>
          <Link
            href="/#demo-searches"
            className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:inline-flex ${isHome ? "text-slate-200 hover:bg-white/10 hover:text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            جستجوهای نمونه
          </Link>
          <Link
            href="/crawl"
            className={`hidden rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:inline-flex ${isHome ? "text-slate-200 hover:bg-white/10 hover:text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}
          >
            خزندهٔ محلی
          </Link>
          <DataModeBadge dark={isHome} />
        </nav>
      </div>
    </header>
  );
}
