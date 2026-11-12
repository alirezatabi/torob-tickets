import Link from "next/link";
import { Plane } from "lucide-react";
import { Wordmark } from "./brand-mark";
import { DemoBadge } from "./demo-badge";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="ترب بلیت — صفحهٔ اصلی" className="rounded-xl p-0.5">
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-2" aria-label="ناوبری اصلی">
          <span className="hidden items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs text-ink-500 sm:inline-flex">
            <Plane className="size-3.5" aria-hidden="true" />
            نسخهٔ نمایشی — پرواز
          </span>
          <DemoBadge />
        </nav>
      </div>
    </header>
  );
}
