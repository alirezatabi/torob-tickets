import Link from "next/link";
import { Plane, Sparkles } from "lucide-react";
import { Wordmark } from "./brand-mark";
import { DataModeBadge } from "./data-mode-badge";
import { searchMode } from "@/modules/providers/registry-live";

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-30 border-b border-ink-200/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="ترب بلیت — صفحهٔ اصلی" className="rounded-xl">
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-2" aria-label="ناوبری اصلی">
          <Link
            href="/#routes"
            className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
          >
            <Plane className="size-3.5" aria-hidden="true" />
            مسیرها
          </Link>
          <Link
            href="/#demo-searches"
            className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            جستجوهای نمونه
          </Link>
          <Link
            href="/live"
            className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
          >
            دادهٔ واقعی
          </Link>
          <DataModeBadge mode={searchMode()} />
        </nav>
      </div>
    </header>
  );
}
