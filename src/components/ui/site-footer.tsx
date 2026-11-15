import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { listProviders } from "@/providers/registry";

export function SiteFooter() {
  const providers = listProviders();

  return (
    <footer className="mt-20 border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark size={26} />
            <span className="font-bold text-ink-900">ترب بلیت</span>
          </div>
          <p className="mt-3 max-w-xs text-xs leading-6 text-ink-500">
            مقایسهٔ قیمت پرواز از چند منبع.
            <br />
            خرید در سایت ارائه‌دهنده انجام می‌شود.
          </p>
        </div>

        <div>
          <h2 className="text-[0.7rem] font-semibold text-ink-700">منابع</h2>
          <ul className="mt-3 space-y-1.5 text-[0.72rem] text-ink-500">
            {providers.map((provider) => (
              <li key={provider.id} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                {provider.name}
                <span className="text-ink-400">({provider.quotedCurrency})</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[0.7rem] font-semibold text-ink-700">داده‌ها</h2>
          <ul className="mt-3 space-y-1.5 text-[0.72rem] leading-5 text-ink-500">
            <li>قیمت‌ها نمونهٔ ساختگی</li>
            <li>نرخ ارز ثابت، نه لحظه‌ای</li>
            <li>
              <Link href="/live" className="font-medium text-teal-700 hover:underline">
                مقایسهٔ تفصیلی یک پرواز
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-100">
        <p className="mx-auto max-w-6xl px-4 py-4 text-[0.65rem] text-ink-400 sm:px-6">
          نمونهٔ محصول برای چالش مهندسی محصول ترب
        </p>
      </div>
    </footer>
  );
}
