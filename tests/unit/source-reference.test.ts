import { describe, expect, it } from "vitest";

import { sourceReferenceFor } from "@/modules/catalog/source-reference";

describe("ticket source reference", () => {
  it("links crawled Safarmarket data to the verified official site", () => {
    expect(sourceReferenceFor({
      dataSource: "crawled",
      provenance: { endpoint: "https://safarmarket.com/api/flight/v3/search" },
    })).toEqual({ href: "https://safarmarket.com/", sourceName: "Safarmarket" });
  });

  it("does not invent a source link for absent, non-crawled, or untrusted provenance", () => {
    expect(sourceReferenceFor({ dataSource: "demo", provenance: { endpoint: "https://safarmarket.com" } })).toBeNull();
    expect(sourceReferenceFor({ dataSource: "crawled", provenance: { endpoint: "https://example.com/flight" } })).toBeNull();
    expect(sourceReferenceFor({ dataSource: "crawled", provenance: undefined })).toBeNull();
  });
});
