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
    const landDots = container.querySelector<SVGPathElement>("[data-globe-land-dots]");
    expect(landDots).not.toBeNull();
    expect(landDots?.getAttribute("stroke")).toBe("#91ddff");
    expect(landDots?.getAttribute("stroke-opacity")).toBe("0.9");
    expect(container.querySelector('[data-land-layer="planet"]')).toBeNull();
    const networkLanes = [...container.querySelectorAll<SVGGElement>("[data-network-flight]")];
    expect(networkLanes.length).toBeGreaterThan(0);
    expect(networkLanes.every((lane) => lane.getAttribute("stroke") === "#43baff")).toBe(true);
    expect(networkLanes.every((lane) =>
      lane.getAttribute("data-origin-visible") === "true" || lane.getAttribute("data-destination-visible") === "true",
    )).toBe(true);
    expect(networkLanes.some((lane) =>
      lane.getAttribute("data-network-from") === "6" && lane.getAttribute("data-network-to") === "15",
    )).toBe(false);
    const serviceMarkers = [...container.querySelectorAll<SVGGElement>("[data-service-marker]")];
    expect(serviceMarkers.length).toBeGreaterThan(0);
    expect(serviceMarkers.every((marker) => {
      const glowDot = marker.querySelector('circle[r="3"]');
      return glowDot?.getAttribute("fill") === "#62c6ff" && glowDot.hasAttribute("filter");
    })).toBe(true);
    expect(container.querySelector('[data-city-icon="pin"]')).toBeNull();
    expect(container.querySelector('[stroke="#ffd17a"]')).toBeNull();
    const airplaneMarkers = [...container.querySelectorAll<SVGGElement>("[data-airplane-marker]")];
    expect(airplaneMarkers.length).toBeGreaterThan(0);
    expect(airplaneMarkers.every((marker) => {
      const icon = marker.querySelector("path");
      return (icon?.getAttribute("d")?.length ?? 0) > 80 && icon?.getAttribute("transform") === "translate(-11.5 -11.5)";
    })).toBe(true);
    const flightExtensions = [...container.querySelectorAll<SVGGElement>("[data-flight-extension]")];
    expect(flightExtensions.length).toBeGreaterThan(0);
    expect(flightExtensions.some((extension) =>
      [...extension.querySelectorAll("path")].some((path) => path.getAttribute("d")?.includes("C")),
    )).toBe(true);
    for (const extension of flightExtensions) {
      const path = extension.querySelector("path")?.getAttribute("d") ?? "";
      const coordinates = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(coordinates.length).toBeGreaterThan(0);
      expect(coordinates.length % 2).toBe(0);
      const radii = Array.from({ length: coordinates.length / 2 }, (_, index) =>
        Math.hypot(coordinates[index * 2]! - 110, coordinates[index * 2 + 1]! - 110),
      );
      expect(Math.min(...radii)).toBeGreaterThan(98);
      expect(Math.max(...radii)).toBeLessThanOrEqual(104);
      for (const subpath of path.split("M").filter(Boolean)) {
        const values = subpath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        const points = Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2]!, values[index * 2 + 1]!] as const);
        const endpoints = [points[0]!, points[points.length - 1]!];
        for (const [x, y] of endpoints) {
          expect(Math.abs(Math.hypot(x - 110, y - 110) - 99)).toBeLessThan(1.5);
        }
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
