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
          <p className="mt-3 max-w-sm text-sm leading-6 text-ink-500">
            قیمت بلیت هواپیما را از چند ارائه‌دهنده جمع می‌کنیم، به یک قالب یکسان تبدیل می‌کنیم و
            بر اساس خواستهٔ شما رتبه‌بندی می‌کنیم. خرید بلیت در سایت ارائه‌دهنده انجام می‌شود.
          </p>
        </div>

        <div>
          <h2 className="text-xs font-semibold text-ink-700">ارائه‌دهندگان نمونه</h2>
          <ul className="mt-3 space-y-2 text-xs text-ink-500">
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
          <h2 className="text-xs font-semibold text-ink-700">دربارهٔ داده‌ها</h2>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-ink-500">
            <li>تمامی قیمت‌ها و پروازها نمونهٔ ساختگی هستند.</li>
            <li>هیچ اتصالی به API واقعی ارائه‌دهندگان وجود ندارد.</li>
            <li>نرخ تبدیل ارز یک جدول نمونه است، نه نرخ لحظه‌ای.</li>
          </ul>
          <Link href="/" className="mt-3 inline-block text-xs font-medium text-teal-600 hover:underline">
            بازگشت به جستجو
          </Link>
        </div>
      </div>

      <div className="border-t border-ink-100">
        <p className="mx-auto max-w-6xl px-4 py-4 text-[0.7rem] text-ink-400 sm:px-6">
          ساخته‌شده برای چالش مهندسی محصول هوش مصنوعی ترب — نمونهٔ محصول، نه سرویس تجاری.
        </p>
      </div>
    </footer>
  );
}
