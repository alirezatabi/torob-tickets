import Link from "next/link";
import { ArrowLeft, BadgeCheck, Layers, Sparkles, Wallet } from "lucide-react";
import { SearchForm } from "@/components/search-form";
import { DemoSearches } from "@/components/demo-searches";
import { listProviders } from "@/providers/registry";
import { toPersianDigits } from "@/lib/format";

export default function HomePage() {
  const providers = listProviders();

  return (
    <div className="relative overflow-hidden">
      {/* Decorative background: a soft flight path, no stock photos. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-[30rem] bg-gradient-to-b from-teal-50/80 via-ink-50 to-ink-50" />
        <svg className="absolute top-6 left-1/2 w-[52rem] -translate-x-1/2 opacity-[0.5]" viewBox="0 0 800 220" fill="none">
          <path
            d="M20 180C150 40 320 210 470 96c84-64 180-46 310-8"
            stroke="url(#route)"
            strokeWidth="1.5"
            strokeDasharray="6 7"
            strokeLinecap="round"
          />
          <circle cx="470" cy="96" r="3.5" fill="#D97706" />
          <circle cx="20" cy="180" r="3.5" fill="#109C88" />
          <defs>
            <linearGradient id="route" x1="0" y1="0" x2="800" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="#109C88" stopOpacity="0.5" />
              <stop offset="0.55" stopColor="#D97706" stopOpacity="0.45" />
              <stop offset="1" stopColor="#24344F" stopOpacity="0.2" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-white px-3 py-1 text-[0.7rem] font-medium text-teal-700 shadow-sm">
            <Sparkles className="size-3.5" aria-hidden="true" />
            قیمت چند ارائه‌دهنده، در یک نگاه
          </span>
          <h1 className="mt-4 text-[1.75rem] font-extrabold leading-[1.35] text-ink-900 sm:text-[2.35rem] sm:leading-[1.3]">
            بلیت هواپیما را <span className="text-teal-700">با خیال راحت</span> انتخاب کنید
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-ink-500 sm:text-[0.95rem]">
            پروازها را از چند ارائه‌دهنده جمع می‌کنیم، قیمت‌ها را یکسان‌سازی می‌کنیم و با توجه به
            خواستهٔ شما — نه فقط ارزان‌ترین قیمت — بهترین گزینه را پیشنهاد می‌دهیم.
          </p>
        </div>

        <div className="mx-auto mt-7 max-w-4xl">
          <SearchForm />
          <DemoSearches />
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
          <Feature
            icon={<Layers className="size-4" aria-hidden="true" />}
            title={`${toPersianDigits(providers.length)} ارائه‌دهنده، یک قالب`}
            body="هر منبع داده، شکل و ارز خودش را دارد؛ همه به یک مدل یکسان تبدیل می‌شوند."
          />
          <Feature
            icon={<Wallet className="size-4" aria-hidden="true" />}
            title="رتبه‌بندی شفاف"
            body="قیمت، مدت سفر، توقف، بار و استرداد در امتیازدهی قطعی و قابل توضیح."
          />
          <Feature
            icon={<BadgeCheck className="size-4" aria-hidden="true" />}
            title="توضیح قابل اتکا"
            body="هوش مصنوعی فقط از داده‌های واقعیِ همان جستجو توضیح می‌سازد؛ عدد نمی‌سازد."
          />
        </div>

        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.7rem] text-ink-400">
          {providers.map((provider) => (
            <span key={provider.id} className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              {provider.name}
            </span>
          ))}
          <Link href="#demo-searches" className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">
            همهٔ جستجوهای نمونه
            <ArrowLeft className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white/70 p-4 backdrop-blur-sm">
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-ink-100 text-ink-700">{icon}</span>
      <h2 className="mt-2.5 text-[0.8rem] font-bold text-ink-800">{title}</h2>
      <p className="mt-1 text-[0.72rem] leading-6 text-ink-500">{body}</p>
    </div>
  );
}
