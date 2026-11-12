import { describe, expect, it } from "vitest";
import { checkGrounding, extractNumbers } from "@/ai/grounding";
import { toGroundingFacts, buildLlmFacts } from "@/ai/explain";
import { rankOffers } from "@/ranking/score";
import { DEFAULT_PREFERENCES } from "@/domain/trip";
import type { FlightOffer } from "@/domain/flight";

const facts = {
  allowedNumbers: [4_250_000, 4.25, 185, 3, 5, 23],
  baggageKnown: true,
  refundKnown: true,
  allowedAirlines: ["ماهان ایر"],
  flightNumber: "W5-107",
};

describe("explanation grounding", () => {
  it("accepts a sentence that only uses provided numbers", () => {
    const result = checkGrounding("این پرواز ۴٬۲۵۰٬۰۰۰ تومان است و ۳ ساعت و ۵ دقیقه طول می‌کشد.", facts);
    expect(result.ok).toBe(true);
  });

  it("rejects an invented price", () => {
    const result = checkGrounding("قیمت این بلیت فقط ۳٬۱۰۰٬۰۰۰ تومان است.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("unsupported-number");
  });

  it("rejects baggage claims when baggage is unknown", () => {
    const result = checkGrounding("این پرواز شامل بار ۲۳ کیلوگرمی است.", { ...facts, baggageKnown: false });
    expect(result.violations).toContain("claims-unknown-baggage");
  });

  it("allows an explicit 'no baggage' statement even when unknown", () => {
    const result = checkGrounding("این پرواز بدون بار همراه است.", { ...facts, baggageKnown: false });
    expect(result.ok).toBe(true);
  });

  it("rejects refund claims when refundability is unknown", () => {
    const result = checkGrounding("بلیت قابل استرداد است.", { ...facts, refundKnown: false });
    expect(result.violations).toContain("claims-unknown-refund");
  });

  it("rejects a different flight number", () => {
    const result = checkGrounding("پرواز TK-873 را انتخاب کنید.", facts);
    expect(result.violations.some((v) => v.startsWith("wrong-flight"))).toBe(true);
  });

  it("rejects non-Persian and over-long output", () => {
    expect(checkGrounding("The cheapest flight is great.", facts).ok).toBe(false);
    expect(checkGrounding("الف ".repeat(200), facts).violations).toContain("too-long");
  });

  it("extracts Persian numbers including millions", () => {
    expect(extractNumbers("۴٬۲۵۰٬۰۰۰ تومان")).toEqual([4_250_000]);
    expect(extractNumbers("۴٫۲ میلیون")).toEqual([4_200_000]);
  });
});

describe("LLM fact payload", () => {
  const offer: FlightOffer = {
    id: "p:1",
    groupKey: "g",
    providerId: "pars",
    providerName: "پارس‌فلایت",
    airlineCode: "W5",
    airlineName: "ماهان ایر",
    flightNumber: "W5-107",
    originCode: "THR",
    destinationCode: "IST",
    departAt: "2026-11-20T03:45:00.000Z",
    arriveAt: "2026-11-20T07:00:00.000Z",
    durationMinutes: 195,
    stops: 0,
    segments: [],
    price: { original: { amount: 4_250_000, currency: "IRT" }, toman: 4_250_000, converted: false },
    baggage: { checked: "unknown", cabinKg: null, checkedKg: null },
    refundable: null,
    cabin: "economy",
    offerUrl: "",
    providerUpdatedAt: "2026-11-19T10:00:00.000Z",
    fetchedAt: "2026-11-19T10:00:00.000Z",
    dataSource: "demo",
    warnings: [],
  };

  it("marks unknown fields so the model cannot claim them", () => {
    const result = rankOffers([offer], DEFAULT_PREFERENCES);
    const payload = buildLlmFacts(offer, result);
    const grounding = toGroundingFacts(payload);
    expect(grounding.baggageKnown).toBe(false);
    expect(grounding.refundKnown).toBe(false);
    expect(grounding.allowedNumbers).toContain(4_250_000);
    expect(grounding.flightNumber).toBe("W5-107");
  });
});
