import type { ProviderAdapter } from "./types";
import { parsAdapter, type ParsRawOffer } from "./flight/pars";
import { alibabaAdapter, flightioAdapter, mahanAdapter } from "./flight/adapters";

/**
 * The provider registry. Adding a provider = writing an adapter + one line here.
 * A future `train` registry would follow the same shape with a different mode.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FLIGHT_PROVIDERS: ProviderAdapter<any>[] = [
  parsAdapter as ProviderAdapter<ParsRawOffer>,
  alibabaAdapter,
  flightioAdapter,
  mahanAdapter,
];

export function listProviders(): { id: string; name: string; mode: "demo" | "live"; description: string; quotedCurrency: string }[] {
  return FLIGHT_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    description: p.description,
    quotedCurrency: p.quotedCurrency,
  }));
}
