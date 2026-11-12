import { NextResponse } from "next/server";

import { parseSearchParams, SORT_KEYS, type SortKeyParam } from "@/lib/search-params";
import { addDays, isoToday } from "@/lib/jalali";
import { runLiveSearch } from "@/server/live-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/live/search?origin=THR&destination=MHD&date=2026-11-20[&mode=live|demo][&sort=best]
 *
 * The live-shaped search endpoint. It returns the same evidence the operator needs to
 * audit a run: per-provider reports, freshness per price, what could not be verified,
 * and whether the DB accepted the history write.
 *
 * In `demo` mode (the default) it never touches a provider — that keeps the demo
 * runnable offline and makes the difference between the two modes explicit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = parseSearchParams(raw, { date: addDays(isoToday(), 7) });

  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason, missing: parsed.missing, mode: raw.mode ?? "demo" },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }

  const requestedMode = raw.mode === "live" || raw.mode === "demo" ? raw.mode : undefined;
  const sort = (SORT_KEYS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SortKeyParam) : "best";

  try {
    const payload = await runLiveSearch(parsed.query, {
      mode: requestedMode,
      sort: sort === "best" ? "best" : sort,
      persist: raw.persist !== "false",
    });
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // The orchestrator isolates providers, so reaching here means a bug — report it
    // without leaking internals.
    return NextResponse.json(
      {
        error: "جست‌وجو با خطای غیرمنتظره متوقف شد",
        detail: error instanceof Error ? error.name : "unknown",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
