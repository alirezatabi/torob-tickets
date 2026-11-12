import { describe, expect, it } from "vitest";
import { parseNaturalLanguage, clarificationQuestion } from "@/ai/nlParser";
import { parseIntent } from "@/ai/schema";
import { understandIntent } from "@/ai/intent";
import { addDays } from "@/lib/jalali";

const TODAY = "2026-11-10"; // Tuesday

describe("natural-language intent parsing (deterministic)", () => {
  it("understands the flagship demo sentence", () => {
    const intent = parseNaturalLanguage(
      "ارزان‌ترین پرواز تهران به استانبول جمعه آینده، با بار و بدون توقف",
      { today: TODAY },
    );
    expect(intent.originCode).toBe("THR");
    expect(intent.destinationCode).toBe("IST");
    expect(intent.pricePreference).toBe("low");
    expect(intent.baggageRequired).toBe(true);
    expect(intent.maxStops).toBe(0);
    expect(intent.missing).toEqual([]);
  });

  it("resolves 'فردا صبح' to tomorrow morning", () => {
    const intent = parseNaturalLanguage("پرواز از تهران به دبی فردا صبح", { today: TODAY });
    expect(intent.departDate).toBe(addDays(TODAY, 1));
    expect(intent.dayPart).toBe("morning");
    expect(intent.destinationCode).toBe("DXB");
  });

  it("resolves 'جمعه' to the next Friday", () => {
    const intent = parseNaturalLanguage("تهران به استانبول جمعه", { today: TODAY });
    // 2026-11-10 is a Tuesday → the coming Friday is 2026-11-13.
    expect(intent.departDate).toBe("2026-11-13");
  });

  it("understands an English request", () => {
    const intent = parseNaturalLanguage("cheapest direct flight from Tehran to Istanbul tomorrow with baggage", {
      today: TODAY,
    });
    expect(intent.originCode).toBe("THR");
    expect(intent.destinationCode).toBe("IST");
    expect(intent.departDate).toBe(addDays(TODAY, 1));
    expect(intent.maxStops).toBe(0);
    expect(intent.baggageRequired).toBe(true);
    expect(intent.pricePreference).toBe("low");
  });

  it("parses a budget in millions and a passenger count", () => {
    const intent = parseNaturalLanguage("پرواز تهران به مشهد برای ۲ نفر زیر ۳ میلیون", { today: TODAY });
    expect(intent.passengers).toBe(2);
    expect(intent.maxPriceToman).toBe(3_000_000);
  });

  it("reports missing essentials instead of guessing an origin", () => {
    const intent = parseNaturalLanguage("پرواز به استانبول", { today: TODAY });
    expect(intent.originCode).toBeNull();
    expect(intent.destinationCode).toBe("IST");
    expect(intent.missing).toContain("origin");
  });

  it("asks a single clarifying question for missing fields", () => {
    const intent = parseNaturalLanguage("می‌خوام برم استانبول", { today: TODAY });
    const question = clarificationQuestion(intent.missing);
    expect(question).not.toBeNull();
    expect(question).toContain("مبدأ");
  });

  it("keeps the route direction from the preposition, not the word order", () => {
    const intent = parseNaturalLanguage("از تهران به کیش", { today: TODAY });
    expect(intent.originCode).toBe("THR");
    expect(intent.destinationCode).toBe("KIH");
  });

  it("reads two cities without a preposition in order of appearance", () => {
    const intent = parseNaturalLanguage("پرواز تهران استانبول", { today: TODAY });
    expect(intent.originCode).toBe("THR");
    expect(intent.destinationCode).toBe("IST");
  });

  it("treats a single mentioned city as the destination", () => {
    const intent = parseNaturalLanguage("کیش", { today: TODAY });
    expect(intent.destinationCode).toBe("KIH");
    expect(intent.missing).toContain("origin");
  });

  it("ignores short city aliases glued inside unrelated Persian words", () => {
    // "برم" (from "می‌خوام برم ...") must not resolve to Rome ("رم").
    const intent = parseNaturalLanguage("می‌خوام برم استانبول", { today: TODAY });
    expect(intent.originCode).toBeNull();
    expect(intent.destinationCode).toBe("IST");
  });

  it("parses a return date only when the return leg has one", () => {
    const intent = parseNaturalLanguage("رفت و برگشت تهران به دبی ۲۰ آذر برگشت ۲۵ آذر", { today: TODAY });
    expect(intent.tripType).toBe("roundtrip");
    expect(intent.departDate).toBe("2026-12-11");
    expect(intent.returnDate).toBe("2026-12-16");
  });

  it("does not invent a return date from the trip type alone", () => {
    const intent = parseNaturalLanguage("رفت و برگشت تهران به استانبول ۲۰ آذر", { today: TODAY });
    expect(intent.tripType).toBe("roundtrip");
    expect(intent.returnDate).toBeNull();
  });

  it("understands the weekend shortcut", () => {
    const intent = parseNaturalLanguage("از تهران به استانبول آخر هفته", { today: "2026-11-10" });
    expect(intent.departDate).toBe("2026-11-12");
  });

  it("returns a safe fallback for unrelated gibberish", () => {
    const intent = parseNaturalLanguage("سلام خوبی", { today: TODAY });
    expect(intent.missing).toEqual(["origin", "destination", "date"]);
    expect(intent.confidence).toBeLessThan(0.5);
  });
});

describe("intent schema validation", () => {
  it("rejects identical origin and destination", () => {
    const result = parseIntent({
      originCode: "THR",
      destinationCode: "THR",
      departDate: "2026-11-20",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed date", () => {
    const result = parseIntent({ originCode: "THR", destinationCode: "IST", departDate: "20/11/2026" });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown airport code (no silent coercion)", () => {
    const result = parseIntent({ originCode: "XXX", destinationCode: "IST", departDate: "2026-11-20" });
    expect(result.ok).toBe(false);
  });

  it("rejects a return date before the departure date", () => {
    const result = parseIntent({
      originCode: "THR",
      destinationCode: "IST",
      departDate: "2026-11-20",
      returnDate: "2026-11-19",
    });
    expect(result.ok).toBe(false);
  });

  it("applies documented defaults for omitted preferences", () => {
    const result = parseIntent({ originCode: "THR", destinationCode: "IST", departDate: "2026-11-20" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.pricePreference).toBe("balanced");
    expect(result.intent.passengers).toBe(1);
    expect(result.intent.maxStops).toBeNull();
  });
});

describe("intent service without an API key", () => {
  it("falls back to the deterministic parser and says so", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await understandIntent("از تهران به استانبول فردا", { today: TODAY });
    expect(result.source).toBe("parser");
    expect(result.fallbackReason).toBe("no-api-key");
    expect(result.intent.destinationCode).toBe("IST");
    if (previous) process.env.OPENAI_API_KEY = previous;
  });
});
