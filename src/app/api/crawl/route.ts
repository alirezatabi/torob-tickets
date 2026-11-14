import { NextResponse } from "next/server";
import { CRAWL_SOURCES, CRAWLER_PARSER_STATUS } from "@/crawler/sources";
import { getCrawlSnapshots } from "@/crawler/snapshot-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status only. Crawls are never triggered by browser/API requests. */
export async function GET() {
  const snapshots = await getCrawlSnapshots(CRAWL_SOURCES.map((source) => source.id));
  return NextResponse.json({ enabled: process.env.CRAWLER_ENABLED === "1", trigger: "local-cli-only", snapshots: snapshots.map(({ source, fetchedAt, route, date, offers }) => ({ source, fetchedAt, route, date, offers: offers.length })), parserStatus: CRAWLER_PARSER_STATUS }, { headers: { "cache-control": "no-store" } });
}

export async function POST() {
  return NextResponse.json({ error: "Crawl jobs are local CLI-only; this endpoint never starts network activity." }, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
}
