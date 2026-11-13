# گزارش پایانی — prompt 02

تاریخ: ۲۰۲۶-۱۱-۱۲ · شاخه: `arena/b4963fa8-torob-tickets` · مبنا: `80329ea`

این گزارش عمداً کوتاه و **بدون ادعای اثبات‌نشده** است: هرچه در بخش ۲ آمده، خروجی واقعی همین
مخزن است؛ آنچه اجرا نشد، در بخش ۴ با دلیل آمده.

---

## ۱. وضعیت هر باگ

| # | وضعیت | چه چیزی عوض شد (کوتاه) |
|---|---|---|
| B1 | ✅ رفع شد | `date` اختیاری و پیش‌فرض «امروز تهران»؛ `2026-13-45` با پیام فارسی رد می‌شود (نه جست‌وجوی خالی). |
| B2 | ✅ رفع شد | خط لوله روی **پرواز** (`buildFlightResults`) مرتب می‌کند؛ هر چهار تب ترتیب واقعاً متفاوت می‌دهند. |
| B3 | ✅ رفع شد | فیلتر روز با `tripMatchesOfferDate` (روز محلی مبدأ) و حذف `|| true`. |
| B4 | ✅ رفع شد | `localDepartDate(iso, tz)` در `lib/time.ts`؛ گروه‌بندی، لینک و نمای زنده از آن استفاده می‌کنند. |
| B5 | ✅ رفع شد | ساعت لینک منبع = ساعت محلی مبدأ (`localDepartTime`)، نه `slice(11,16)` از UTC. |
| B6 | ✅ رفع شد | ظرفیت demo از `seededUnit` و `passengers` واقعاً در قابلیت خرید و قیمت کل اثر دارد. |
| B7 | ✅ رفع شد | `domesticMesh()`: ۲۰ مسیر غیرتهرانی دوطرفه؛ اصفهان⇄کیش با IR ~۱۳:۰۰ و Y9 ~۱۹:۰۰ روزانه. |
| B8 | ✅ رفع شد | `Y9` (کیش‌ایر) در رجیستری ایرلاین‌ها. |
| B9 | ✅ رفع شد | گزینهٔ رفت‌وبرگشت **غیرفعال** با برچسب «به‌زودی» و توضیح؛ هیچ ورودی نیمه‌کاره‌ای نمی‌گیرد. |
| B10 | ✅ رفع شد | طول اسفند = ۲۹/۳۰ (اندازه‌گیری واقعی تا ۱ فروردین). |
| B11 | ✅ رفع شد | `jalaliToIso` و پارسر تاریخ، روز/ماه ناموجود را خطا می‌دهند (`1405-12-30` صامت به فروردین نمی‌رود). |
| B12 | ✅ رفع شد | «سه‌شنبه هفته بعد» = سه‌شنبهٔ هفتهٔ بعد؛ «۲ نفر دیگر» دیگر ماه «دی» نمی‌شود (مرز کلمه). |
| B13 | ✅ رفع شد | `groupOffers` ورودی را mutate نمی‌کند؛ کلید روی نسخهٔ تازه زده می‌شود. |
| B14 | ✅ رفع شد | جهت وابستگی `ranking/score.ts` → `modules/ranking/core.ts`؛ چرخه حذف شد. |
| B15 | ✅ رفع شد | `now` تا adapterهای demo می‌رود؛ `runSearch({now})` نتایج را واقعاً بازتولید می‌کند (تست تکرارپذیری). |
| B16 | ✅ رفع شد | فیلتر ایرلاین **یک** معنا دارد: ترجیح سخت (حذف از لیست در `filterGroups`)، نه ضریب نرم اضافه. |
| B17 | ✅ رفع شد | README با کد یکی شد (۱۲۳ → در واقع ۱۳۷ مسیر / ۴۷ شهر / ۲۳ ایرلاین) و `readme-facts.test.ts` این اعداد را قفل می‌کند. |
| B18 | ✅ رفع شد | `seededUnit` تقسیم بر `2**32` (بازهٔ `[0,1)`)، یک نسخه در `lib/time.ts`. |
| B19 | ✅ رفع شد | مقایسه‌گر strict-weak؛ تساوی‌شکن با code point، نه `localeCompare`. |
| B20 | ✅ رفع شد | `WEEKEND = [4,5]` (پنج‌شنبه/جمعه) هم‌راستا با کامنت‌ها و `quoteFare`. |
| B21 | ✅ مستند شد | `docs`/README: کش و rate-limit **در حافظهٔ هر پروسس**؛ روی serverless مشترک نیست. |
| B22 | ✅ رفع شد | نوشتن audit در Server Component `await` می‌شود. |
| B23 | ✅ رفع شد | `/api/intent` (۲۰/دقیقه) و `/api/explain` (۳۰/دقیقه): محدودیت نرخ، سقف طول ورودی، `429 + retry-after`، خطای فارسی. |
| S1 | ✅ رفع شد | هیچ `.env` در مخزن نیست (`git ls-files` فقط `.env.example`)؛ سیاست چرخش کلید در `docs/COMPLIANCE.md` §Secrets. چرخش کلید بیرون از این مخزن است و باید توسط مالک انجام شود. |

**اضافه بر فهرست، در همین دور:** کارت‌های `/live` حالا از همان `selectCheapestOffer` می‌آیند
(`cheapestOfferId`/`soldOut`)، و `filterGroups` فیلدهای مشتق‌شدهٔ گروه را از نو می‌سازد
(`rebuildGroup`) — باگ «قیمت/فروشندهٔ ردیفی که دیگر نمایش داده نمی‌شود».

## ۲. خروجی واقعی دستورها

```
$ npm run typecheck
> tsc --noEmit
(بدون خطا)

$ npm run lint
> eslint .
(بدون خطا)

$ npm test
 Test Files  38 passed (38)
      Tests  412 passed (412)

$ npm run build
 ✓ Generating static pages (9/9)
(موفق)

$ npx playwright test --list
Total: 36 tests in 2 files

$ npm run test:e2e
Running 36 tests using 1 worker
  ✘ … browserType.launch: Executable doesn't exist at
    /home/user/.cache/ms-playwright/chromium_headless_shell-1254/…
  (۳۶ تست نوشته شده‌اند، هیچ‌کدام اجرا نشد — دلیل در بخش ۴)
```

راه‌رفت HTTP واقعی روی `next start` (پورت ۳۴۰۳، مسیر اصفهان→کیش، بدون تاریخ):

```
PASS no date -> 200 results
PASS exactly 8 chips :: 8
PASS first chip selected (today)
PASS chip labels explain price/absence
PASS >=2 flight cards :: 2
PASS IR-3301 card present once
PASS Y9-7204 card present once
PASS every card has >=3 sellers
PASS shown price == min of sellers :: ('۵٬۰۳۰٬۰۰۰ تومان', [5030000, 5150000, 5150000])
PASS exactly one 'کمترین' per card
PASS sort=earliest changes first card
PASS sort=fastest renders
PASS pax=9 mentions capacity truth
PASS pax=4 shows total price
PASS pax=4 shows per-person and total
PASS sold-out cards come last
PASS impossible date -> Persian error
PASS api returns flights :: 2
PASS api cheapest == per-person price
PASS api marks soldOut flag
PASS api pax=9 total = 9x per-person when purchasable
ALL OK   (۲۱/۲۱)
```

`/live` روی همان مسیر: ۲ کارت، «۳ منبع» / «۴ منبع»، «کمترین» روی ارزان‌ترین نرخ، و با
`pax=9` هر دو کارت «تکمیل ظرفیت برای این تعداد مسافر».

## ۳. تصمیم‌هایی که خودم گرفتم

- **sort پیش‌فرض = ارزان‌ترین** (تبِ اول).
- **`LOW_SEATS_THRESHOLD = 5`** (صندلی کم = هشدار)؛ **۰ صندلی «کم» نیست**، «تکمیل ظرفیت» است —
  این تفکیک در تست DOM قفل شده است.
- **ظرفیت پرواز = max** بین منابع (نه جمع)، و `null` وقتی هیچ منبعی عدد نمی‌دهد.
- **«ارزان‌ترین با بار»** فقط تا **۱۵٪** گران‌تر پیشنهاد می‌شود.
- **مهلت فروش ۹۰ دقیقه** پیش از پرواز (`SALES_CUTOFF_MINUTES`)؛ روزِ تمام‌شده = لیست خالی، نه خطا.
- **رفت‌وبرگشت غیرفعال** به‌جای اجرای نصفه.
- **نوار تاریخ ۸ روز** (امروز … امروز+۷)، هر چیپ یک لینک واقعی که تمام پارامترها را نگه می‌دارد.
- **پیام‌های «ناشناخته»** به‌جای صفر: صندلی نامعلوم، بار نامعلوم، قیمت ارزی غیرقابل‌مقایسه.

## ۴. چه چیزی انجام نشد و چرا (خطرهای باقی‌مانده)

1. **`npm run test:e2e` اجرا نشد.** مرورگر Playwright در این سندباکس نصب است ولی باینری‌اش موجود
   نیست و `npx playwright install` با `ECONNRESET` به `cdn.playwright.dev` شکست می‌خورد. ۳۶ تست
   نوشته و فهرست شده‌اند؛ به‌جایشان همان سناریو با ۲۱ بررسی HTTP روی سرور واقعی اجرا شد.
   **خطر:** نگه‌دارنده‌های DOM (مثل نام `data-testid`) ممکن است بی‌صدا تغییر کنند.
2. **اتصال به منابع واقعی آزمایش نشد.** سندباکس به سایت‌های هدف دسترسی ندارد؛ سپهر۳۶۰/Amadeus
   فقط با fixture تست شده‌اند. **خطر:** پارسر صفحه ممکن است در محیط واقعی متفاوت باشد.
3. **Prisma**: تولید کلاینت/مهاجرت نیاز به شبکه دارد؛ لایهٔ ماندگاری در دمو غیرفعال می‌ماند و
   «تاریخچه ثبت نشد» صادقانه نمایش داده می‌شود. **خطر:** مسیر تاریخچهٔ قیمت روی Postgres واقعی
   در این محیط اجرا نشده است.
4. **رفت‌وبرگشت و قطار** پیاده نشده‌اند (اولی غیرفعال با برچسب، دومی فقط مدل دامنه).
5. **rate-limit و کش درون‌حافظه‌ای‌اند**؛ روی چند نمونه/serverless مشترک نیستند (مستند شده).
6. **چرخش کلید `OPENAI_API_KEY`/`DATABASE_URL`** خارج از این مخزن است و باید توسط مالک انجام شود.

## ۵. اسکریپت دموی ۵ دقیقه‌ای

در `docs/DEMO.md` نوشته شده و با محصول واقعی هم‌راستاست: مسئله (۰:۰۰) → جست‌وجوی زبان طبیعی و
سپس **سناریوی مرجع اصفهان→کیش بدون انتخاب تاریخ** (۸ چیپ، دو پرواز، ≥۳ فروشنده برای هر پرواز،
«کمترین» روی ارزان‌ترین) → عوض کردن روز و sort → مسافر ۹ و «تکمیل ظرفیت» → مرزهای صداقت
(«نمونه»، «نامشخص»، لینک = صفحهٔ جست‌وجوی منبع).

---

## ۶. به‌روزرسانی بعدی: حذف کامل لایهٔ دادهٔ واقعی

به درخواست مالک محصول، **کل سیستم دریافت دادهٔ واقعی حذف شد** و محصول فعلاً فقط با دادهٔ نمونه
پیش می‌رود. این تغییر بخشی از فهرست باگ‌ها نیست و تصمیم محصولی است؛ اما پیامدهای فنی زیر را
دارد و صادقانه ثبت می‌شود:

**حذف شد**

- `src/modules/providers/` (کانکتور سپهر۳۶۰، کانتکتور Amadeus، قرارداد ارائه‌دهنده،
  ارکستریتور هم‌زمانی، HTTPallowlist/robots/retry، کش TTL، API-discovery، diagnostics،
  آداپتورهای آماده‌سازی نرخ).
- `/api/go/sepehr360` و `src/modules/live/source-link.ts` — در این نسخه هیچ کارتی لینک بیرونی
  ندارد؛ به‌جای «دیدن در منبع»، همان مسیر به‌صورت جست‌وجوی درون‌برنامه‌ای پیشنهاد می‌شود.
- اسکریپت‌های `provider:check`، `search:live`، `source:probe`، `fixtures:refresh`.
- مستندات مربوط: `docs/PROVIDERS.md`، `docs/SOURCES.md`، `docs/DESIGN-LIVE.md`،
  `docs/PHASE4-VERIFICATION.md`.
- ۱۲ فایل تست که فقط همان کانکتورها را می‌سنجیدند.

**ماند و بازنویسی شد**

- `src/modules/catalog/` — `demo-providers.ts` (تنها حالت `demo` + `ProviderRunReport`)،
  `offer-identity.ts` (هویت نرخ برای تاریخچه)، `fare-facts.ts`، `demo-link.ts`.
- `src/server/live-search.ts` — از `runSearch` نمونه می‌خواند؛ نه ارکستریتور، نه vérification،
  نه سوییچ محیطی. `now` تزریق‌شدنی ماند (تست‌ها و نوار تاریخ).
- `/live`، `/api/live/search`، `/api/live/history`، `/api/health` — همه ماندند، با برچسب ثابت
  «نمونه» و `mode: "demo"`.
- دیتابیس و تاریخچهٔ قیمت (Prisma/Postgres) — دست‌نخورده و همچنان **اختیاری**.

**تست نگهبان جدید:** `tests/unit/demo-only.test.ts` مطمئن می‌شود هیچ فایل کانکتوری، هیچ
سوییچ محیطی و هیچ URL بیرونی به `src/` برنگردد.

**خروجی gate بعد از این تغییر**

```
npm run typecheck → بدون خطا
npm run lint      → بدون خطا
npm test          → 27 فایل / 253 تست موفق
npm run build     → ✓ 9/9 صفحه
walkthrough (next start, IFN→KIH, date=2026-11-20) → 21/21 PASS
/api/health       → {"status":"degraded","mode":"demo","dataSource":{"kind":"demo"...}}
```
