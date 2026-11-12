/**
 * Identity: a paper-plane folded out of a price tag.
 * Simple enough to read at 20px, distinct from Torob's own mark.
 */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="40" height="40" rx="12" fill="url(#brand-gradient)" />
      <path
        d="M9.5 20.4 30.2 12.1a1 1 0 0 1 1.32 1.24l-4.3 14.6a1.6 1.6 0 0 1-2.65.76l-4.3-3.96-3.1 3.55c-.6.68-1.72.26-1.72-.65v-4.34l9.06-6.5-11.3 5.1-3.2-1.36a.85.85 0 0 1 .06-1.6l.03-.01Z"
        fill="#fff"
      />
      <circle cx="30.6" cy="9.6" r="3.1" fill="#FBBF24" stroke="#0D1729" strokeOpacity=".18" />
      <defs>
        <linearGradient id="brand-gradient" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#109C88" />
          <stop offset="1" stopColor="#0D1729" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={34} />
      <span className="flex flex-col leading-none">
        <span className="text-[1.05rem] font-extrabold tracking-tight text-ink-900">ترب بلیت</span>
        {!compact && (
          <span className="mt-0.5 text-[0.62rem] font-medium tracking-wide text-ink-400">
            مقایسهٔ هوشمند بلیت سفر
          </span>
        )}
      </span>
    </span>
  );
}
