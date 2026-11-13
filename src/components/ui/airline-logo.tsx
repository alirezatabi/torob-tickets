import { airlineBrand, EMBLEM_PATHS } from "@/lib/airlines/brand";
import { getAirline } from "@/lib/airlines";
import { cn } from "@/lib/cn";
import { toPersianDigits } from "@/lib/format";

/**
 * The carrier badge that leads every flight row.
 *
 * A marketing airline comparison is scanned by carrier first: the badge is the visual anchor
 * that lets someone find “the Iran Air one” without reading. This renders the carrier's livery
 * colours with a simple emblem and the IATA code, in one inline SVG per row (no network, no
 * sprite, no layout shift, and it works in the server-rendered HTML before hydration).
 *
 * The marks are drawn for this demo rather than copied from the airlines' registered logos;
 * `title` says which carrier it stands for, and the code is always printed next to it, so the
 * badge is identity, never decoration pretending to be a brand asset.
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
  const brand = airlineBrand(code);
  const known = getAirline(code);
  const emblem = EMBLEM_PATHS[brand.emblem] ?? EMBLEM_PATHS.wing!;
  const gradientId = `airline-${code.replace(/[^A-Za-z0-9]/g, "") || "xx"}-${size}`;
  const label = name ?? known?.fa ?? code;
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
    >
      <title>{`${label} (${code})`}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={brand.from} />
          <stop offset="100%" stopColor={brand.to} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      {/* A single specular highlight reads as a glossy chip at any size. */}
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
