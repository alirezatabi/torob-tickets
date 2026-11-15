import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const environmentExample = readFileSync(path.join(root, ".env.example"), "utf8");

describe("repository hygiene", () => {
  it("ignores local environment files and crawl data while retaining the placeholder template", () => {
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
    expect(gitignore).toContain("/data/crawl/");
    expect(gitignore).toContain("*.tmp");
  });

  it("documents Basisfly configuration names without concrete values", () => {
    for (const variable of ["BASISFLY_REQUEST_TEMPLATE", "BASISFLY_LOCATION_IDS", "SECRET_TOROB"]) {
      expect(environmentExample).toContain(variable);
    }
    expect(environmentExample).not.toMatch(/(?:Bearer\s+[A-Za-z0-9._-]{12,}|SECRET_TOROB\s*=\s*[^\s#]{8,})/i);
  });

  it("removes obsolete private prompts and stale planning reports", () => {
    for (const file of [
      "02-torob-tickets-agent-prompt.md",
      "torob-ticket-prompt.md",
      "docs/REPORT-02.md",
      "docs/PLAN-02.md",
      "response.json",
    ]) {
      expect(existsSync(path.join(root, file)), `${file} should not be present`).toBe(false);
    }
  });
});
