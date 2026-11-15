import type { ParsedIntent } from "@/ai/schema";

/**
 * Shared state shape for the natural-language search action.
 *
 * Kept in its own module on purpose: a `"use server"` file may only export async
 * functions, so the initial state object and its type must live outside of it.
 */
export interface IntentActionState {
  ok: boolean;
  intent: ParsedIntent | null;
  source: "llm" | "parser" | null;
  error: string | null;
}

export const INITIAL_INTENT_STATE: IntentActionState = {
  ok: false,
  intent: null,
  source: null,
  error: null,
};
