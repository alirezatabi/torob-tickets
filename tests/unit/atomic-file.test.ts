import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteFile } from "@/crawler/atomic-file";

describe("atomicWriteFile", () => {
  it("replaces an existing target and leaves no temporary files behind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crawler-atomic-"));
    const target = join(directory, "latest.json");
    try {
      await atomicWriteFile(target, "first\n");
      await atomicWriteFile(target, "second\n");
      expect(await readFile(target, "utf8")).toBe("second\n");
      expect(await readdir(directory)).toEqual(["latest.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
