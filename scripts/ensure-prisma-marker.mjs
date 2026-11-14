#!/usr/bin/env node
/**
 * Writes a one-line `package.json` next to the generated Prisma client.
 *
 * The problem (reported as a Console Error in the dev overlay):
 *
 *   [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/src/generated/prisma/client.ts
 *   is not specified and it doesn't parse as CommonJS. Reparsing as ES module…
 *
 * Prisma 7's `prisma-client` generator emits ESM, and the project's own `package.json` is
 * CommonJS. The narrowest correct fix is to tell Node what the *generated folder* contains —
 * `{"type":"module"}` — instead of flipping the module format of the entire project.
 *
 * `prisma generate` owns that folder and may clear it, so the marker is re-created here after
 * every generate. Running this before generate is harmless: it also creates the folder, and the
 * generator writes into it either way.
 *
 *   node scripts/ensure-prisma-marker.mjs      # idempotent
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "src/generated/prisma/package.json");
const contents = `${JSON.stringify({ type: "module" }, null, 2)}\n`;

mkdirSync(path.dirname(target), { recursive: true });

if (existsSync(target) && readFileSync(target, "utf8") === contents) {
  console.log(`prisma marker: already present (${path.relative(root, target)})`);
} else {
  writeFileSync(target, contents);
  console.log(`prisma marker: wrote ${path.relative(root, target)}`);
}
