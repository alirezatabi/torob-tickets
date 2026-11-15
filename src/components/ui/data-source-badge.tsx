import { FlaskConical, Radio } from "lucide-react";

export function DataSourceBadge({ source, variant = "badge" }: { source: "demo" | "live" | "crawled"; variant?: "badge" | "inline" }) {
  const label = source === "demo" ? "دادهٔ نمونه" : source === "crawled" ? "دادهٔ واقعی · snapshot" : "دادهٔ واقعی";
  const styles = source === "demo"
    ? "border-saffron-300/60 bg-saffron-50 text-saffron-700"
    : "border-teal-300/60 bg-teal-50 text-teal-800";
  const Icon = source === "demo" ? FlaskConical : Radio;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${variant === "inline" ? "text-[0.61rem]" : "text-xs"} ${styles}`} title={source === "crawled" ? "نرخ از snapshot محلی ذخیره‌شده؛ تازه‌بودن و موجودی باید دوباره بررسی شود." : undefined}>
    <Icon className="size-3.5" aria-hidden="true" />{label}
  </span>;
}
