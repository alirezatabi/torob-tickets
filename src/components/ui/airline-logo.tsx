import Image from "next/image";

import { airlineBrand, EMBLEM_PATHS } from "@/lib/airlines/brand";
import { getAirline } from "@/lib/airlines";
import { airlineLogoPath } from "@/lib/airlines/logos";
import { cn } from "@/lib/cn";
import { toPersianDigits } from "@/lib/format";

/**
 * The carrier mark that leads every flight row.
 *
 * A price comparison is scanned by *carrier* first: the eye finds “the Iran Air one” long
 * before it reads a flight number. So each row shows that airline's **own logo**, bundled with
 * the app and served from `/airline-logos/<CODE>.<ext>` — no network, no CDN, nothing to load
 * late. The workspace preview often has no outbound access at all, so this is the only way the
 * marks can be relied on.
 *
 * The logo sits in a fixed square box (so a row is a straight column of equal marks and nothing
 * shifts when the artwork loads) on a white chip (most marks are drawn for white and carry
 * their own colour). Marks are single-symbol only — where an airline's logo comes with a
 * wordmark, the wordmark is cropped away and the name is printed next to it in Persian.
 *
 * Two carriers have no permissively licensed vector mark, so their bundled raster logo is used
 * (`ZV`, `XQ`, `HY`, `IA`). A carrier we have no bundle for — an unknown code from a future
 * dataset — falls back to the drawn badge below: a livery-coloured chip with an emblem and the
 * IATA code. It is labelled as a stand-in and looks deliberately different, so it is never
 * mistaken for an airline's real logo.
 */
export function AirlineLogo({
  code,
  name,
  size = 40,
  className,
}: {
  code: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const known = getAirline(code);
  const label = name ?? known?.fa ?? code;
  const src = airlineLogoPath(code);
  const padding = Math.max(2, Math.round(size * 0.11));

  if (!src) {
    return <DrawnBadge code={code} label={label} size={size} className={className} />;
  }

  return (
    <span
      role="img"
      aria-label={`نشان ${label}`}
      title={`${label} (${code})`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[9px] border border-ink-100 bg-white shadow-[0_1px_2px_rgb(11_20_36_/_0.10)]",
        className,
      )}
      style={{ width: size, height: size, padding }}
      data-testid="airline-logo"
      data-airline={code}
      data-logo="real"
    >
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="size-full object-contain"
        aria-hidden="true"
        draggable={false}
      />
    </span>
  );
}

/** The stand-in badge: livery colours, a drawn emblem, and the IATA code, in one inline SVG. */
function DrawnBadge({
  code,
  label,
  size,
  className,
}: {
  code: string;
  label: string;
  size: number;
  className?: string;
}) {
  const brand = airlineBrand(code);
  const emblem = EMBLEM_PATHS[brand.emblem] ?? EMBLEM_PATHS.wing!;
  const gradientId = `airline-${code.replace(/[^A-Za-z0-9]/g, "") || "xx"}-${size}`;
  const showCode = size >= 38;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={`نشان ${label}`}
      className={cn("shrink-0 drop-shadow-[0_2px_6px_rgb(11_20_36_/_0.18)]", className)}
      data-testid="airline-logo"
      data-airline={code}
      data-logo="drawn"
    >
      <title>{`${label} (${code})`}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={brand.from} />
          <stop offset="100%" stopColor={brand.to} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      <path d="M0 14C0 6.3 6.3 0 14 0h20L0 34V14z" fill="#fff" opacity="0.10" />
      <g transform={showCode ? "translate(12 8) scale(0.42)" : "translate(12 11) scale(0.5)"}>
        <path d={emblem} fill="#fff" fillOpacity="0.96" />
      </g>
      {showCode && (
        <text
          x="24"
          y="41"
          textAnchor="middle"
          fill="#fff"
          fontSize="10.5"
          fontWeight="700"
          letterSpacing="0.6"
          fontFamily="var(--font-sans), system-ui, sans-serif"
        >
          {code === "??" ? "؟" : toPersianDigits(code)}
        </text>
      )}
    </svg>
  );
}
