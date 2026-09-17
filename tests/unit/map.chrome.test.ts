// @vitest-environment jsdom
/**
 * The two things the map undoes in MapLibre's chrome once it has loaded.
 *
 * The attribution strip is built here the way MapLibre builds it, a
 * `<details>` with the classes its compact mode adds, so the collapse is
 * checked against the real markup and not a guess at it. Rotation is two
 * handler calls, recorded on a stand-in.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_SHOWN,
  collapseAttribution,
  disableRotation,
} from "../../src/views/map/mapChrome";

/** The strip as MapLibre leaves it after load: compact, and open. */
function openStrip(): HTMLDetailsElement {
  const strip = document.createElement("details");
  strip.className = `maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact ${ATTRIBUTION_SHOWN}`;
  strip.setAttribute("open", "");
  const button = document.createElement("summary");
  button.className = "maplibregl-ctrl-attrib-button";
  const credit = document.createElement("div");
  credit.className = "maplibregl-ctrl-attrib-inner";
  credit.textContent = "© OpenMapTiles";
  strip.append(button, credit);
  return strip;
}

describe("collapseAttribution", () => {
  it("closes the open strip and says so", () => {
    const container = document.createElement("div");
    const strip = openStrip();
    container.append(strip);

    expect(collapseAttribution(container)).toBe(true);

    expect(strip.classList.contains(ATTRIBUTION_SHOWN)).toBe(false);
    expect(strip.hasAttribute("open")).toBe(false);
    // Still compact: the "i" button stays, and a click reopens the credit.
    expect(strip.classList.contains("maplibregl-compact")).toBe(true);
  });

  it("leaves a strip that is already closed, or absent, alone", () => {
    const container = document.createElement("div");
    const strip = openStrip();
    strip.classList.remove(ATTRIBUTION_SHOWN);
    container.append(strip);
    expect(collapseAttribution(container)).toBe(false);
    expect(collapseAttribution(document.createElement("div"))).toBe(false);
  });
});

describe("disableRotation", () => {
  it("turns off rotation by touch and by key, and nothing else", () => {
    const map = {
      touchZoomRotate: { disableRotation: vi.fn(), disable: vi.fn() },
      keyboard: { disableRotation: vi.fn(), disable: vi.fn() },
    };
    disableRotation(map);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.disableRotation).toHaveBeenCalledOnce();
    // Pinch still zooms, and the arrow keys still pan.
    expect(map.touchZoomRotate.disable).not.toHaveBeenCalled();
    expect(map.keyboard.disable).not.toHaveBeenCalled();
  });
});
