import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { SiteHeader } from "@/components/ui/site-header";
import { SiteFooter } from "@/components/ui/site-footer";

export const metadata: Metadata = {
  title: {
    default: "ترب بلیت — مقایسهٔ قیمت بلیت هواپیما",
    template: "%s | ترب بلیت",
  },
  description:
    "ترب بلیت قیمت بلیت هواپیما را از چند ارائه‌دهنده جمع می‌کند، یکسان‌سازی می‌کند و با توجه به خواستهٔ شما بهترین گزینه را پیشنهاد می‌دهد.",
  applicationName: "ترب بلیت",
  keywords: ["بلیت هواپیما", "مقایسه قیمت", "پرواز", "ارزان‌ترین بلیت", "ترب"],
  openGraph: {
    title: "ترب بلیت — مقایسهٔ هوشمند قیمت بلیت",
    description: "قیمت پروازها را از چند ارائه‌دهنده در یک صفحه مقایسه کنید.",
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d7a6c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen bg-ink-50 text-ink-900">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:right-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          رفتن به محتوای اصلی
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
