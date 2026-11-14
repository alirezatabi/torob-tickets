import Image from "next/image";

import { getAirline } from "@/lib/airlines";
import { airlineLogoPath } from "@/lib/airlines/logos";
import { cn } from "@/lib/cn";
import { toPersianDigits } from "@/lib/format";

/** Show a bundled authentic airline mark, or an unmistakably neutral code-only placeholder. */
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
  const src = airlineLogoPath(code, label);
  const padding = Math.max(2, Math.round(size * 0.11));

  if (!src) {
    return (
      <span
        role="img"
        aria-label={`لوگوی رسمی ${label} در دسترس نیست`}
        title={`${label} (${code}) · لوگوی رسمی در دسترس نیست`}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[9px] border border-dashed border-ink-300 bg-ink-50 font-bold tracking-tight text-ink-500",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.27)) }}
        data-testid="airline-logo"
        data-airline={code}
        data-logo="unavailable"
      >
        {toPersianDigits(code.toUpperCase())}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={`لوگوی ${label}`}
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
