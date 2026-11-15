import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const REPLACE_ERROR_CODES = new Set(["EPERM", "EEXIST", "ENOTEMPTY", "EBUSY"]);

/**
 * Write a complete temp file before replacing the target. Windows can reject
 * rename-over-existing with EPERM (for example while Defender has the file open),
 * so retry briefly, then move the old target aside and roll it back if replacement
 * fails. This keeps the previous snapshot intact on a failed replace.
 */
export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const id = `${process.pid}.${randomUUID()}`;
  const temp = join(directory, `.${basename(path)}.${id}.tmp`);
  const backup = join(directory, `.${basename(path)}.${id}.bak`);
  await writeFile(temp, contents, { mode: 0o600, flag: "wx" });

  try {
    try {
      await rename(temp, path);
      return;
    } catch (firstError) {
      if (!isReplaceError(firstError)) throw firstError;
    }

    // Antivirus/indexers occasionally hold a just-written file briefly.
    for (const waitMs of [100, 300, 700]) {
      await delay(waitMs);
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        if (!isReplaceError(error)) throw error;
      }
    }

    let backedUp = false;
    try {
      await rename(path, backup);
      backedUp = true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // Another process removed the old target while this write was waiting.
    }

    try {
      await rename(temp, path);
    } catch (replaceError) {
      if (backedUp) {
        try {
          await rename(backup, path);
        } catch (restoreError) {
          throw new AggregateError([replaceError, restoreError], `Could not replace ${path} or restore its previous version`);
        }
      }
      throw replaceError;
    }

    if (backedUp) await unlink(backup).catch(() => undefined);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

function isReplaceError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && REPLACE_ERROR_CODES.has(String(error.code)));
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
