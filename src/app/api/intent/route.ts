import { NextResponse } from "next/server";
import { z } from "zod";
import { understandIntent } from "@/ai/intent";
import { clarificationQuestion } from "@/ai/nlParser";
import { clientKey, INTENT_RATE_LIMIT, rateLimit } from "@/modules/api/rate-limit";

export const runtime = "nodejs";

/**
 * Input limits (B23): a 3–400 character Persian sentence. The maximum is a product decision,
 * not a technical accident — the parser only ever reads a route, a date and a few preferences,
 * and an unbounded body is an easy way to burn tokens.
 */
const BodySchema = z.object({
  text: z.string().trim().min(3, "متن درخواست خیلی کوتاه است").max(400, "متن درخواست بیش از حد بلند است"),
});

/**
 * Natural language → structured intent.
 * Always returns a usable answer: the deterministic parser is the baseline and an
 * LLM (if configured) can only refine it within the validated schema.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`intent:${clientKey(request)}`, INTENT_RATE_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "بدنهٔ درخواست باید JSON باشد." }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(payload);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues[0]?.message ?? "درخواست نامعتبر است." },
      { status: 422 },
    );
  }

  const result = await understandIntent(parsedBody.data.text);
  const question = clarificationQuestion(result.intent.missing);

  return NextResponse.json(
    {
      intent: result.intent,
      source: result.source,
      question,
      latencyMs: result.latencyMs,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
