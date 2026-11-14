import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { PopularRoutes } from "@/app/(home)/_components/popular-routes";
import { Hero } from "@/app/(home)/_components/hero";
import { SearchForm } from "@/app/(home)/_components/search-form";

/** Revalidate real snapshot-backed fares periodically; never manufacture fallback prices. */
export const revalidate = 900;

export default function HomePage() {
  return (
    <div className="relative">
      <Hero badge="فقط نرخ‌های واقعیِ snapshotشده از Safarmarket · بدون بلیت نمونه">
        <SearchForm />
      </Hero>

      <section className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#f2f7fb_0%,#f8fafc_36%,#f1f7f7_100%)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-40 top-12 size-[28rem] rounded-full bg-sky-100/55 blur-[100px]" />
          <div className="absolute -left-40 top-[38rem] size-[30rem] rounded-full bg-teal-100/45 blur-[110px]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-sky-200 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-5 sm:px-6 sm:pt-8 lg:px-8">
          <PopularRoutes />

          <section className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/90 bg-white/75 px-4 py-4 shadow-[0_12px_30px_-26px_rgba(15,35,55,0.3)]">
            <p className="flex items-start gap-2 text-[0.7rem] leading-6 text-ink-600">
              <Database className="mt-1 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              نتایج فقط از snapshotهای واقعی Safarmarket در همین نصب خوانده می‌شوند. جست‌وجوی سایت خودش crawl را اجرا یا موجودی بلیت را دوباره تأیید نمی‌کند.
            </p>
            <Link href="/crawl" className="group inline-flex shrink-0 items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-[0.67rem] font-bold text-teal-800 transition-colors hover:bg-teal-100">
              وضعیت دادهٔ واقعی
              <ArrowLeft className="size-3 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            </Link>
          </section>
        </div>
      </section>
    </div>
  );
}
