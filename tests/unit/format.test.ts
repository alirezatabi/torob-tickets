import { describe, expect, it } from "vitest";
import { gregorianToJalali, jalaliToGregorian, formatJalali, addDays, isoToday, weekdayIndex } from "@/lib/jalali";
import { formatToman, formatTomanCompact, formatDuration, toPersianDigits, formatStops } from "@/lib/format";

describe("Jalali calendar", () => {
  it("converts known anchor dates", () => {
    expect(gregorianToJalali(2026, 3, 21)).toEqual({ year: 1405, month: 1, day: 1 });
    expect(gregorianToJalali(2026, 11, 10)).toEqual({ year: 1405, month: 8, day: 19 });
    expect(jalaliToGregorian(1405, 1, 1)).toEqual({ year: 2026, month: 3, day: 21 });
  });

  it("round-trips a range of dates", () => {
    for (let day = 1; day <= 28; day += 3) {
      const iso = `2026-09-${String(day).padStart(2, "0")}`;
      const j = gregorianToJalali(2026, 9, day);
      const g = jalaliToGregorian(j.year, j.month, j.day);
      expect(`${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`).toBe(iso);
    }
  });

  it("formats Persian dates with Persian digits", () => {
    expect(formatJalali("2026-11-10")).toBe("۱۹ آبان");
    expect(formatJalali("2026-11-10", "weekday")).toBe("سه‌شنبه");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("computes weekdays", () => {
    expect(weekdayIndex("2026-11-10")).toBe(2); // Tuesday
  });

  it("derives an ISO civil date for today", () => {
    expect(isoToday(new Date("2026-11-10T20:00:00.000Z"))).toBe("2026-11-10");
  });
});

describe("Persian formatting", () => {
  it("formats toman with Persian digits and thousands separators", () => {
    expect(formatToman(4_250_000)).toBe("۴٬۲۵۰٬۰۰۰ تومان");
  });

  it("formats compact prices", () => {
    expect(formatTomanCompact(4_250_000)).toBe("۴٫۲۵ میلیون تومان");
    expect(formatTomanCompact(12_000_000)).toBe("۱۲ میلیون تومان");
    expect(formatTomanCompact(850_000)).toBe("۸۵۰ هزار تومان");
  });

  it("formats durations in Persian", () => {
    expect(formatDuration(185)).toBe("۳ ساعت و ۵ دقیقه");
    expect(formatDuration(120)).toBe("۲ ساعت");
    expect(formatDuration(45)).toBe("۴۵ دقیقه");
  });

  it("formats stop counts", () => {
    expect(formatStops(0)).toBe("بدون توقف");
    expect(formatStops(1)).toBe("۱ توقف");
    expect(formatStops(2)).toBe("۲ توقف");
  });

  it("converts latin digits to Persian", () => {
    expect(toPersianDigits("TK-873 / 2026")).toBe("TK-۸۷۳ / ۲۰۲۶");
  });
});
