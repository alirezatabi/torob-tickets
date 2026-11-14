import type { HistoryPoint } from "@/modules/history/price-history";
import { formatToman, toPersianDigits } from "@/lib/format";

/**
 * A minimal, dependency-free SVG sparkline over real observations.
 *
 * Two design rules it enforces:
 *   • points are plotted in time order at their *real* timestamps, so a long gap looks
 *     like a long gap — no interpolation, no smoothing;
 *   • a single observation renders as a dot with an explicit note instead of a
 *     misleading flat line.
 *
 * Inline SVG keeps it server-rendered, accessible (`role="img"` + a text summary) and
 * free of client JS.
 */
export function HistoryChart({ points, height = 84 }: { points: HistoryPoint[]; height?: number }) {
  if (points.length === 0) {
    return <p className="mt-3 text-[0.68rem] text-ink-400">مشاهده‌ای ثبت نشده است.</p>;
  }

  const width = 320;
  const padding = 6;
  const prices = points.map((point) => point.priceToman);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const times = points.map((point) => new Date(point.observedAt).getTime());
  const startTime = Math.min(...times);
  const endTime = Math.max(...times);
  const span = Math.max(1, endTime - startTime);

  const x = (time: number) => padding + ((time - startTime) / span) * (width - padding * 2);
  const y = (price: number) =>
    prices.length === 1 || max === min
      ? height / 2
      : height - padding - ((price - min) / (max - min)) * (height - padding * 2);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(times[index] ?? startTime).toFixed(1)},${y(point.priceToman).toFixed(1)}`)
    .join(" ");

  const summary = [
    `${toPersianDigits(points.length)} مشاهده`,
    `کمینه ${formatToman(min)}`,
    `بیشینه ${formatToman(max)}`,
  ].join(" · ");

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`نمودار قیمت: ${summary}`}
        className="overflow-visible"
        preserveAspectRatio="none"
      >
        {/* Baseline grid: 3 faint rules only, to keep the eye on the data. */}
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={padding + ratio * (height - padding * 2)}
            y2={padding + ratio * (height - padding * 2)}
            stroke="currentColor"
            className="text-ink-200"
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
        ))}

        {points.length > 1 ? (
          <path d={path} fill="none" stroke="currentColor" className="text-teal-600" strokeWidth={1.6} strokeLinejoin="round" />
        ) : null}

        {points.map((point, index) => (
          <circle
            key={`${point.observedAt}-${index}`}
            cx={x(times[index] ?? startTime)}
            cy={y(point.priceToman)}
            r={points.length === 1 ? 3 : 2}
            className={point.freshness === "fresh" ? "fill-teal-600" : "fill-saffron-500"}
          >
            <title>
              {`${formatToman(point.priceToman)} — ${new Date(point.observedAt).toISOString().slice(0, 16).replace("T", " ")}`}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[0.58rem] text-ink-400">
        <span>{points.length === 1 ? "یک مشاهده — خط روند معنا ندارد" : summary}</span>
        <span>
          {toPersianDigits(points.length)} نقطه
          {points.length > 1 ? " (بدون پر کردن فاصله‌ها)" : ""}
        </span>
      </figcaption>
    </figure>
  );
}
