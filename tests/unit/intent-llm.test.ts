import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Llm from "@/ai/llm";

const llm = vi.hoisted(() => ({ text: "" }));
vi.mock("@/ai/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof Llm>();
  return {
    ...actual,
    isLlmEnabled: () => true,
    completeJson: async () => ({ text: llm.text, model: "test", latencyMs: 0 }),
  };
});

import { understandIntent } from "@/ai/intent";

const TODAY = "2026-11-10";
const basePayload = {
  originCode: "THR",
  destinationCode: "DXB",
  departDate: "2026-11-20",
  returnDate: null,
  tripType: "oneway",
  passengers: 1,
  cabin: "economy",
  pricePreference: "balanced",
  maxStops: null,
  baggageRequired: false,
  refundableOnly: false,
  dayPart: null,
  maxPriceToman: null,
  preferredAirlines: [],
  confidence: 0.9,
};

beforeEach(() => {
  llm.text = JSON.stringify(basePayload);
});

describe("LLM date guardrails", () => {
  it("keeps a valid date found by the deterministic parser over the LLM's alternative", async () => {
    const result = await understandIntent("پرواز از تهران به دبی فردا", { today: TODAY });
    expect(result.source).toBe("llm");
    expect(result.intent.departDate).toBe("2026-11-11");
  });

  it.each(["2026-02-30", "2026-13-01", "2026-11-09"])(
    "rejects impossible or past model date %s and falls back to the detected date",
    async (departDate) => {
      llm.text = JSON.stringify({ ...basePayload, departDate });
      const result = await understandIntent("پرواز از تهران به دبی فردا", { today: TODAY });
      expect(result.source).toBe("llm");
      expect(result.intent.departDate).toBe("2026-11-11");
    },
  );
});
