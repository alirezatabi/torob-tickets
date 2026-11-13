import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { AIRLINE_LOGO_ASSETS, airlineLogoPath } from "@/lib/airlines/logos";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "src", "lib", "airlines", "logos");
const TYPES = { svg: "image/svg+xml", png: "image/png" } as const;

/**
 * GET /airline-logos/<CODE>.<svg|png> — one bundled carrier logo, served from the repo.
 *
 * The airlines' marks live in the source tree (not on a CDN) so the app renders identities
 * with no network at all. Only the 23 codes in `AIRLINE_LOGO_ASSETS` are reachable: the
 * code is looked up in that table first, so no request can name an arbitrary file.
 *
 * Immutable for a year — a logo changes only when we ship a new build.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const match = /^([A-Z0-9]{2})\.(svg|png)$/.exec(file);
  const asset = match ? AIRLINE_LOGO_ASSETS[match[1]!] : undefined;

  if (!match || !asset || asset.format !== match[2] || airlineLogoPath(match[1]!) !== `/airline-logos/${file}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const body = await readFile(path.join(DIR, file));
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": TYPES[asset.format],
        "content-length": String(body.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
