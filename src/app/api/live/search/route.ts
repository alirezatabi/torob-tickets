import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The former demo-backed live endpoint is intentionally retired. */
export async function GET() {
  return NextResponse.json(
    {
      error: "این endpoint نمونه حذف شده است.",
      messageFa: "برای جست‌وجوی واقعی از /api/search استفاده کنید؛ فقط snapshotهای محلی Safarmarket بررسی می‌شوند.",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
