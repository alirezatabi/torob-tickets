"use server";

import { understandIntent } from "@/ai/intent";
import type { IntentActionState } from "./intent-state";

/**
 * Server action behind the natural-language search box.
 *
 * It lives on the server so the LLM key never reaches the browser and so the
 * feature still works when the client cannot reach a separate API route.
 *
 * NOTE: a `"use server"` module may only export async functions. The initial
 * state object lives in `./intent-state` for exactly that reason.
 */
export async function intentAction(_previous: IntentActionState, formData: FormData): Promise<IntentActionState> {
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 3) {
    return {
      ok: false,
      intent: null,
      source: null,
      error: "درخواست شما خیلی کوتاه است. مثلاً: «پرواز تهران به استانبول فردا»",
    };
  }

  try {
    const result = await understandIntent(text);
    return { ok: true, intent: result.intent, source: result.source, error: null };
  } catch {
    return {
      ok: false,
      intent: null,
      source: null,
      error: "درک درخواست ممکن نشد. لطفاً از فرم جستجو استفاده کنید.",
    };
  }
}
