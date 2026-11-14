import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitySelect } from "@/components/ui/city-select";
import { DatePicker } from "@/components/ui/date-picker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function placeNearViewportBottom(element: HTMLElement) {
  const rect = {
    x: 40,
    y: 700,
    top: 700,
    right: 280,
    bottom: 744,
    left: 40,
    width: 240,
    height: 44,
    toJSON: () => ({}),
  };
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
}

describe("search form popovers", () => {
  it("renders the city menu above its trigger outside clipping cards", () => {
    render(
      <div style={{ overflow: "hidden" }}>
        <CitySelect id="origin" label="مبدأ" value="" onChange={() => undefined} />
      </div>,
    );
    const trigger = screen.getByRole("combobox", { name: "مبدأ" });
    placeNearViewportBottom(trigger);
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    const panel = listbox.parentElement;
    expect(panel?.parentElement).toBe(document.body);
    expect(panel?.style.position).toBe("fixed");
    expect(Number.parseFloat(panel?.style.top ?? "0")).toBeLessThan(700);
    expect(Number.parseFloat(panel?.style.maxHeight ?? "0")).toBeGreaterThan(0);
  });

  it("keeps the Jalali calendar fully accessible above the search card", () => {
    render(
      <div style={{ overflow: "hidden" }}>
        <DatePicker id="depart-date" label="تاریخ رفت" value="2026-11-20" onChange={() => undefined} />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /تاریخ رفت/ });
    placeNearViewportBottom(trigger);
    fireEvent.click(trigger);

    const calendar = screen.getByRole("dialog", { name: "تقویم شمسی" });
    expect(calendar.parentElement).toBe(document.body);
    expect(calendar.style.position).toBe("fixed");
    expect(Number.parseFloat(calendar.style.top)).toBeLessThan(700);
    expect(calendar.querySelectorAll("button").length).toBeGreaterThan(31);
  });
});
