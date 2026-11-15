import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import { AirlineLogo } from "@/components/ui/airline-logo";

describe("unknown airline logo fallback", () => {
  it("shows a neutral code instead of drawing an invented brand", () => {
    const { container } = render(createElement(AirlineLogo, { code: "ZZ", name: "Unknown Air", size: 40 }));
    expect(screen.getByRole("img").getAttribute("data-logo")).toBe("unavailable");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("لوگوی رسمی");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img").textContent).toBe("ZZ");
  });
});
