import Link from "next/link";
import { ArrowLeft, BadgeCheck, Layers, Radar, Sparkles, Timer, Wallet } from "lucide-react";
import { SearchForm } from "@/app/(home)/_components/search-form";
import { DemoSearches } from "@/app/(home)/_components/demo-searches";
import { RouteExplorer, CityIndex } from "@/app/(home)/_components/route-explorer";
import { listProviders } from "@/providers/registry";
import { airlineCount } from "@/lib/airlines";
import { routeCount, servedCities } from "@/lib/schedules";
import { CITIES } from "@/lib/cities";
import { toPersianDigits } from "@/lib/format";

export default function HomePage() {
  const providers = listProviders();
  const routes = routeCount();
  const cities = servedCities().length;

  return (
    <div className="relative overflow-hidden">
      {/* ——— Hero backdrop: layered mesh + hairline grid + flight arc ——— */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem]">
        <div className="mesh absolute inset-0" />
        <div className="grid-lines absolute inset-0 opacity-45" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-50" />
        <svg
          className="absolute top-24 left-1/2 w-[58rem] -translate-x-1/2 text-teal-600/45"
          viewBox="0 0 900 240"
          fill="none"
        >
          <path
            d="M30 200C170 46 350 226 520 104c92-66 200-46 350-4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="7 9"
            strokeLinecap="round"
          />
          <circle cx="520" cy="104" r="4" fill="#d97706" />
          <circle cx="30" cy="200" r="4" fill="#0f8a78" />
          <circle cx="870" cy="100" r="3" fill="#0b1424" opacity="0.35" />
        </svg>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-6 pt-12 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-600/15 bg-white/80 px-3 py-1.5 text-[0.7rem] font-bold text-teal-800 shadow-sm backdrop-blur">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {toPersianDigits(providers.length)} ارائه‌دهنده · {toPersianDigits(routes)} مسیر · قیمت‌های یکسان‌سازی‌شده
          </span>

          <h1 className="mt-5 text-[1.85rem] font-black leading-[1.3] text-ink-900 sm:text-[2.6rem] sm:leading-[1.25]">
            بلیت هواپیما را <span className="brand-gradient-text">هوشمندانه</span> مقایسه کنید
          </h1>

          <p className="mx-auto mt-3.5 max-w-xl text-[0.85rem] leading-7 text-ink-500 sm:text-[0.95rem]">
            درخواستتان را بنویسید — «شنبه از تهران به استانبول با بار، زیر ۵ میلیون» — و ما مبدأ، مقصد،
            تاریخ و ترجیحات را می‌فهمیم، قیمت‌ها را از چند ارائه‌دهنده مقایسه می‌کنیم و با رتبه‌بندی
            شفاف بهترین گزینه را نشان می‌دهیم.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-4xl">
          <SearchForm />
          <DemoSearches />
        </div>

        {/* ——— Trust strip: the four claims the product actually keeps ——— */}
        <div className="mx-auto mt-9 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={<Layers className="size-4" aria-hidden="true" />}
            title={`${toPersianDigits(providers.length)} ارائه‌دهنده`}
            body="هر منبع شکل و ارز خودش را دارد؛ همه به یک مدل یکسان تبدیل می‌شوند."
            accent="teal"
          />
          <Feature
            icon={<Wallet className="size-4" aria-hidden="true" />}
            title="رتبه‌بندی شفاف"
            body="قیمت، مدت سفر، توقف، بار و استرداد در یک امتیاز قابل توضیح."
            accent="saffron"
          />
          <Feature
            icon={<BadgeCheck className="size-4" aria-hidden="true" />}
            title="توضیح قابل اتکا"
            body="هوش مصنوعی فقط از دادهٔ همین جستجو توضیح می‌سازد؛ عدد نمی‌سازد."
            accent="ink"
          />
          <Feature
            icon={<Radar className="size-4" aria-hidden="true" />}
            title={`${toPersianDigits(cities)} شهر`}
            body={`از داخلی تا اروپا و آسیای میانه؛ ${toPersianDigits(airlineCount())} ایرلاین در دادهٔ نمونه.`}
            accent="ink"
          />
        </div>

        <RouteExplorer />
        <CityIndex />

        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.7rem] text-ink-400">
          {providers.map((provider) => (
            <span key={provider.id} className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              {provider.name}
            </span>
          ))}
          <Link href="/#demo-searches" className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline">
            همهٔ جستجوهای نمونه
            <ArrowLeft className="size-3" aria-hidden="true" />
          </Link>
        </div>

        <p className="mx-auto mt-6 flex max-w-4xl items-center justify-center gap-1.5 text-center text-[0.68rem] text-ink-400">
          <Timer className="size-3" aria-hidden="true" />
          دادهٔ نمایشی — همهٔ قیمت‌ها ساختگی و برای نمایش قابلیت‌ها هستند. ({toPersianDigits(CITIES.length)} شهر در
          کاتالوگ)
        </p>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: "teal" | "saffron" | "ink";
}) {
  const tone =
    accent === "teal"
      ? "bg-teal-50 text-teal-700 ring-teal-600/10"
      : accent === "saffron"
        ? "bg-saffron-50 text-saffron-600 ring-saffron-500/10"
        : "bg-ink-100 text-ink-700 ring-ink-700/5";

  return (
    <div className="card card-hover p-4">
      <span className={`inline-flex size-9 items-center justify-center rounded-xl ring-1 ${tone}`}>{icon}</span>
      <h2 className="mt-3 text-[0.82rem] font-bold text-ink-900">{title}</h2>
      <p className="mt-1 text-[0.72rem] leading-6 text-ink-500">{body}</p>
    </div>
  );
}
