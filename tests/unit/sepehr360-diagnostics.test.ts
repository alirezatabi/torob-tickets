import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseSearchPage } from "@/modules/providers/sepehr360/parser";
import { diagnosePage, explainEmptyPage } from "@/modules/providers/shared/diagnostics";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "src/modules/providers/sepehr360/__fixtures__", name), "utf8");

describe("sepehr360 empty-page diagnosis", () => {
  it("recognises a JavaScript shell instead of blaming the parser", () => {
    const diagnostics = diagnosePage(fixture("js-shell.html"), false);

    expect(diagnostics.reason).toBe("results-require-js");
    expect(diagnostics.loaderHints.length).toBeGreaterThan(0);
    expect(diagnostics.title).toContain("سپهر");
    expect(explainEmptyPage(diagnostics)).toContain("جاوااسکریپت");
    // The point of the message: it must name the real cause, not "markup changed".
    expect(explainEmptyPage(diagnostics)).not.toContain("قالب صفحه تغییر کرده");
  });

  it("says 'markup changed' only when result cards really were found", () => {
    expect(diagnosePage("<html><body><p>هیچ</p></body></html>", true).reason).toBe("markup-changed");
    expect(explainEmptyPage(diagnosePage("<html><body><p>هیچ</p></body></html>", true))).toContain("تغییر کرده");
  });

  it("falls back to 'unknown page' when there is no evidence either way", () => {
    const diagnostics = diagnosePage("<html><body><p>هیچ</p></body></html>", false);
    expect(diagnostics.reason).toBe("unknown-page");
    expect(diagnostics.numericSnippets).toEqual([]);
  });

  it("never includes raw HTML in the diagnostics payload", () => {
    const diagnostics = diagnosePage(fixture("js-shell.html"), false);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("<script");
    expect(serialized).not.toContain("<div");
  });

  it("keeps numeric evidence short, so a price box can be recognised without republishing it", () => {
    const html = `<html><body><h1>نتایج</h1><span>مبلغ 5.902.000 تومان</span></body></html>`;
    const diagnostics = diagnosePage(html, false);
    expect(diagnostics.numericSnippets.some((snippet) => /5\.902\.000/.test(snippet))).toBe(true);
    expect(diagnostics.numericSnippets.every((snippet) => snippet.length <= 40)).toBe(true);
  });
});

describe("sepehr360 card detection precision", () => {
  it("does not mistake a dotted price for a departure time", () => {
    // "1.450.000 تومان" must not satisfy the clock pattern; without a real hh:mm there
    // is no flight row, and claiming one would fabricate a departure time.
    const html = `<html><body><div class="price-box"><span>1.450.000 تومان</span></div></body></html>`;
    expect(parseSearchPage(html).offers).toHaveLength(0);
  });

  it("reads times from labels when the layout puts arrival first", () => {
    const html = `<html><body>
      <div class="card">
        <span>ورود 09:00</span><span>خروج 07:30</span>
        <span>ایران ایر</span><span>5,902,000 تومان</span>
      </div>
    </body></html>`;
    const [card] = parseSearchPage(html).offers;
    expect(card?.departTime).toBe("07:30");
    expect(card?.arriveTime).toBe("09:00");
  });

  it("does not glue neighbouring elements into an impossible clock", () => {
    // "07:30" + "09:00" concatenated is "07:3009:00"; the separated-text pass must
    // still see two valid clocks rather than one broken token.
    const html = `<html><body>
      <div class="card"><span>07:30</span><span>09:00</span><span>ماهان</span><span>6,120,000 تومان</span></div>
    </body></html>`;
    const [card] = parseSearchPage(html).offers;
    expect(card?.departTime).toBe("07:30");
    expect(card?.arriveTime).toBe("09:00");
  });
});
