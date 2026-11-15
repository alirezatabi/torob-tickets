import { cn } from "@/lib/cn";

/**
 * Torob Ticket identity.
 *
 * Borrows the Torob gesture — an open ring cradling a pair of leaves — and turns it
 * into a *travel* mark: the ring opens at the top-right like a departure gate and a
 * paper plane lifts out of it. Colours come from the app palette (teal ring, saffron
 * leaves, ink/teal plane), so the mark matches the UI instead of fighting it.
 *
 * Drawn as one path per shape, so it stays crisp from 16px (favicon) to 512px.
 */
const RING = "M420.98 146.72A199 199 0 1 1 168.76 79.14L197.7 138.46A133 133 0 1 0 398.9 168.97Z";

export function BrandMark({
  size = 32,
  className = "",
  tile = false,
}: {
  size?: number;
  className?: string;
  /** Draw a rounded white tile behind the mark (use on coloured or busy backgrounds). */
  tile?: boolean;
}) {
  // Gradient ids must be unique per instance — a page can render the mark twice.
  const id = `tt-${tile ? "tile" : "bare"}-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={id} x1="84" y1="48" x2="428" y2="472" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2EC3AE" />
          <stop offset="0.55" stopColor="#0F8A78" />
          <stop offset="1" stopColor="#0A4D47" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect width="512" height="512" rx="116" />
        </clipPath>
      </defs>

      <g clipPath={tile ? `url(#${id}-clip)` : undefined}>
        {tile && <rect width="512" height="512" rx="116" fill="#fff" />}
        <path d={RING} fill={`url(#${id})`} />
        <ellipse
          cx="248.6"
          cy="46.1"
          rx="44"
          ry="25"
          fill="#B45309"
          transform="rotate(-62 248.6 46.1)"
        />
        <ellipse
          cx="419.9"
          cy="120.4"
          rx="58"
          ry="31"
          fill="#FBBF24"
          transform="rotate(-20 419.9 120.4)"
        />
        <g transform="translate(252 286) rotate(-44) scale(1.6)">
          <path d="M66 0-58-38l34 36z" fill="#0B1424" />
          <path d="M66 0-24-2l-28 34z" fill="#0F8A78" />
        </g>
      </g>
    </svg>
  );
}

export function Wordmark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={36} />
      <span className="flex flex-col leading-none">
        <span className={cn("text-[1.05rem] font-extrabold tracking-tight", inverse ? "text-white" : "text-ink-900")}>ترب بلیت</span>
        {!compact && (
          <span className={cn("mt-0.5 text-[0.62rem] font-medium tracking-wide", inverse ? "text-slate-300" : "text-ink-400")}>
            مقایسهٔ قیمت بلیت هواپیما
          </span>
        )}
      </span>
    </span>
  );
}
