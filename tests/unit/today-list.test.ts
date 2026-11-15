import { describe, expect, it } from "vitest";

import { createQuery } from "@/domain/trip";
import { groupOffers } from "@/dedupe/group";
import { buildFlightResults } from "@/modules/search/results";
import { isoToday } from "@/lib/jalali";
import { runSearch } from "@/providers/search";
import { SALES_CUTOFF_MINUTES } from "@/ranking/score";

/**
 * §7: a departure that has already gone (or is inside the ticket-sales cutoff) must not be in
 * today's list. "Past" is a fact about the injected clock, not about the machine.
 */

const today = isoToday(new Date("2026-11-12T00:00:00Z"));
const query = createQuery({ originCode: "IFN", destinationCode: "KIH", departDate: today });

async function listAt(nowIso: string) {
  const now = new Date(nowIso);
  const outcome = await runSearch(query, { now });
  const groups = groupOffers(outcome.offers);
  const results = buildFlightResults(groups, query, { passengers: 1, cabin: query.cabin, sort: "earliest" });
  return results.flights.map((flight) => flight.group.primary.departAt);
}

describe("today's list never shows a departed flight", () => {
  it("keeps a flight that departs comfortably later today", async () => {
    // The first Isfahan→Kish departure is 09:30Z; at 06:00Z it is still sellable.
    const departAt = await listAt("2026-11-12T06:00:00Z");
    expect(departAt).toContain("2026-11-12T09:30:00.000Z");
  });

  it("drops a flight that already left", async () => {
    const departAt = await listAt("2026-11-12T12:00:00Z");
    expect(departAt).not.toContain("2026-11-12T09:30:00.000Z");
    // …and everything that remains is still in the future.
    for (const at of departAt) expect(new Date(at).getTime()).toBeGreaterThan(new Date("2026-11-12T12:00:00Z").getTime());
  });

  it("returns an empty list — not an error — when the day is over", async () => {
    expect(await listAt("2026-11-12T23:00:00Z")).toEqual([]);
  });

  it("uses the named sales cutoff, so the boundary is testable", async () => {
    // 08:00Z is exactly 90 minutes before the 09:30Z departure: the cutoff, not "now", decides.
    expect(SALES_CUTOFF_MINUTES).toBe(90);
    const exactlyAtCutoff = new Date("2026-11-12T08:00:00Z");
    expect(new Date("2026-11-12T09:30:00.000Z").getTime() - exactlyAtCutoff.getTime()).toBe(SALES_CUTOFF_MINUTES * 60_000);
    // One minute later the departure is 89 minutes away and must be gone.
    expect(await listAt("2026-11-12T08:01:00Z")).not.toContain("2026-11-12T09:30:00.000Z");
    // One minute earlier it is 91 minutes away and still listed.
    expect(await listAt("2026-11-12T07:59:00Z")).toContain("2026-11-12T09:30:00.000Z");
  });
});
