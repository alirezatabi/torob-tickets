import { describe, expect, it } from "vitest";
import { localToUtcIso, wallClockInZone, minutesBetween } from "@/lib/time";
import { formatTimeInZone } from "@/lib/format";

describe("timezone conversion", () => {
  it("treats 08:30 in Tehran as 05:00 UTC", () => {
    // Iran has used UTC+3:30 without DST since 2022.
    expect(localToUtcIso("2026-11-20", 8 * 60 + 30, "Asia/Tehran")).toBe("2026-11-20T05:00:00.000Z");
  });

  it("round-trips wall clock through UTC", () => {
    const utc = localToUtcIso("2026-11-20", 18 * 60 + 45, "Europe/Istanbul");
    expect(wallClockInZone(utc, "Europe/Istanbul")).toEqual({ date: "2026-11-20", time: "18:45" });
  });

  it("handles overnight flights crossing local midnight", () => {
    const depart = localToUtcIso("2026-11-20", 23 * 60 + 50, "Asia/Tehran");
    const arrive = new Date(new Date(depart).getTime() + 330 * 60_000).toISOString();
    expect(wallClockInZone(arrive, "Europe/Istanbul").date).toBe("2026-11-21");
    expect(minutesBetween(depart, arrive)).toBe(330);
  });

  it("formats times with Persian digits", () => {
    expect(formatTimeInZone("2026-11-20T05:00:00.000Z", "Asia/Tehran")).toBe("۰۸:۳۰");
  });
});
