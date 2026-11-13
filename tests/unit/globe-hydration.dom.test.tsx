import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobeScene } from "@/components/ui/globe-scene";

describe("globe hydration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps SVG ids and projected marker attributes identical between server and client", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const globe = createElement(GlobeScene, { planet: true, size: 220, period: 150 });
    container = document.createElement("div");
    const serverHtml = renderToString(globe);
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    expect(container.querySelectorAll('[data-land-layer="planet"] path[fill]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-land-layer="planet"] path[stroke]')).toBeNull();
    const networkLanes = [...container.querySelectorAll<SVGGElement>("[data-network-flight]")];
    expect(networkLanes.length).toBeGreaterThan(0);
    expect(networkLanes.every((lane) => lane.getAttribute("stroke") === "#43baff")).toBe(true);
    const flightExtensions = [...container.querySelectorAll<SVGGElement>("[data-flight-extension]")];
    expect(flightExtensions.length).toBeGreaterThan(0);
    for (const extension of flightExtensions) {
      const path = extension.querySelector("path")?.getAttribute("d") ?? "";
      const segments = [...path.matchAll(/M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)L(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)];
      expect(segments.length).toBeGreaterThan(0);
      for (const segment of segments) {
        const coordinates = segment.slice(1).map(Number);
        const radii = [0, 2].map((index) =>
          Math.hypot(coordinates[index]! - 110, coordinates[index + 1]! - 110),
        );
        expect(Math.max(...radii)).toBeGreaterThan(98);
        expect(Math.max(...radii)).toBeLessThanOrEqual(118);
      }
    }

    // SVG transform attributes must use a canonical precision, not the raw result of atan2
    // (which may differ by the last floating-point bit between server and browser runtimes).
    const serverPlaneTransforms = [...serverHtml.matchAll(/transform="(translate\([^)]*\) rotate\([^)]*\))"/g)].map(
      (match) => match[1],
    );
    expect(serverPlaneTransforms.length).toBeGreaterThan(0);
    expect(serverPlaneTransforms.every((transform) => /rotate\(-?\d+\.\d\)$/.test(transform ?? ""))).toBe(true);

    const errors: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });

    await act(async () => {
      root = hydrateRoot(container!, globe);
    });

    expect(errors.join("\n")).not.toMatch(/hydration|did not match|server rendered html/i);
    consoleError.mockRestore();
  });
});
