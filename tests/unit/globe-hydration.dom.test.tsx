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
    container.innerHTML = renderToString(globe);
    document.body.appendChild(container);

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
