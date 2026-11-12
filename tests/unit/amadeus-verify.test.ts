import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AmadeusAdapter } from "@/modules/providers/amadeus/adapter";
import { parseFlightOffersResponse, type AmadeusRawOffer } from "@/modules/providers/amadeus/parse";
import { verifyAmadeusOffer } from "@/modules/providers/amadeus/verify";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "src/modules/providers/amadeus/__fixtures__", name), "utf8");

const offer = parseFlightOffersResponse(JSON.parse(fixture("flight-offers.json")), "test").offers[0] as AmadeusRawOffer;

/** An adapter whose `verifyOffer` is scripted — no network, no token exchange. */
function adapterWith(verifyOffer: () => Promise<unknown>): AmadeusAdapter {
  const adapter = new AmadeusAdapter({
    enabled: true,
    env: "test",
    credentials: { clientId: "i", clientSecret: "s" },
  });
  vi.spyOn(adapter, "verifyOffer").mockImplementation(verifyOffer as never);
  return adapter;
}

describe("amadeus re-verification", () => {
  it("confirms an unchanged price and reports the verification instant", async () => {
    const adapter = adapterWith(async () => ({
      ok: true,
      total: { amount: 31_245, currency: "EUR" },
      reason: null,
    }));

    const outcome = await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" }, new Date("2026-11-12T10:00:00Z"));

    expect(outcome).toMatchObject({ status: "verified", priceChanged: false });
    if (outcome.status === "verified") expect(outcome.verifiedAt).toBe("2026-11-12T10:00:00.000Z");
  });

  it("flags a changed price instead of silently accepting it", async () => {
    const adapter = adapterWith(async () => ({ ok: true, total: { amount: 34_120, currency: "EUR" }, reason: null }));
    const outcome = await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" });
    expect(outcome).toMatchObject({ status: "verified", priceChanged: true });
  });

  it("reports an unavailable fare with Amadeus' own reason", async () => {
    const adapter = adapterWith(async () => ({ ok: false, total: null, reason: "Fare no longer available" }));
    const outcome = await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") expect(outcome.reasonFa).toContain("Fare no longer available");
  });

  it("says verification is not possible when the network fails — never a false positive", async () => {
    const adapter = adapterWith(async () => {
      throw new Error("socket hang up");
    });
    const outcome = await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" });
    expect(outcome.status).toBe("not-possible");
  });

  it("is not possible without credentials", async () => {
    const adapter = new AmadeusAdapter({ enabled: false, env: "test", credentials: null });
    const outcome = await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" });
    expect(outcome.status).toBe("not-possible");
  });

  it("sends the original offer payload to the pricing endpoint", async () => {
    const adapter = new AmadeusAdapter({
      enabled: true,
      env: "test",
      credentials: { clientId: "i", clientSecret: "s" },
    });
    const spy = vi.spyOn(adapter, "verifyOffer");
    spy.mockResolvedValue({ ok: true, total: { amount: 31_245, currency: "EUR" }, reason: null });

    await verifyAmadeusOffer(adapter, offer, { amountMinor: 31_245, currency: "EUR" });
    expect(spy).toHaveBeenCalledWith(offer.raw);
    expect(offer.raw.id).toBe("1");
  });
});
