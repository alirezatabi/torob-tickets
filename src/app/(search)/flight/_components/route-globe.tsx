import { GlobeScene } from "@/components/ui/globe-scene";
import { GlobeStatic } from "@/components/ui/globe-static";
import { distanceKm, bearing, type Point } from "@/lib/geo";
import { toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The globe on a ticket page.
 *
 * The disc itself is `GlobeScene` (client, three-dimensional, draggable). This wrapper only owns the
 * caption — which is the part that has to stay honest: the distance, the initial bearing, a note
 * that the projection is magnified, and a note that the arc is lifted for legibility.
 */

export interface GlobeProps {
  origin: Point;
  destination: Point;
  originLabel: string;
  destinationLabel: string;
  className?: string;
}

export function Globe({
  origin,
  destination,
  originLabel,
  destinationLabel,
  className,
}: GlobeProps) {
  const km = distanceKm(origin, destination);
  const heading = Math.round(bearing(origin, destination));

  return (
    <>
      {/* With JavaScript off, the interactive figure is replaced by a still one built from the same
          coastline and the same great-circle arc. Without the style rule both would show, because
          the live figure is also rendered on the server. */}
      <noscript>
        <style>{`[data-globe="live"]{display:none!important}`}</style>
        <GlobeStatic
          origin={origin}
          destination={destination}
          originLabel={originLabel}
          destinationLabel={destinationLabel}
        />
      </noscript>
      <GlobeScene
        origin={origin}
        destination={destination}
        originLabel={originLabel}
        destinationLabel={destinationLabel}
        size={360}
        controls
        className={cn("mx-auto w-full max-w-[22rem]", className)}
        caption={
          <>
            <p className="nums flex items-center justify-center gap-2 text-[0.68rem] text-ink-600">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full bg-teal-600"
                  aria-hidden="true"
                />
                {originLabel}
              </span>
              <span className="text-ink-300">←</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full bg-saffron-600"
                  aria-hidden="true"
                />
                {destinationLabel}
              </span>
            </p>
            <p className="nums text-[0.66rem] text-ink-500">
              {toPersianDigits(Math.round(km / 10) * 10)} کیلومتر
              <span className="mx-1.5 text-ink-300">·</span>
              دایرة‌المعارف بزرگ
              <span className="mx-1.5 text-ink-300">·</span>
              جهت {toPersianDigits(heading)}°
            </p>
            <p className="text-[0.6rem] leading-5 text-ink-400">
              با کشیدن، کره را بچرخانید. مسیر روی دایرة‌المعارف بزرگ است و برای
              خوانایی کمی از سطح زمین بلند شده؛ بزرگ‌نمایی نماست، نه اندازهٔ
              واقعی ارتفاع پرواز.
            </p>
          </>
        }
      />
    </>
  );
}
