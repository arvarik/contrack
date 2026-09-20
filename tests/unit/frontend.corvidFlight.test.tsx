// @vitest-environment jsdom
/**
 * The flight overlay.
 *
 * Four things matter here and none of them is how pretty the curve is, which
 * `corvid.flightPath.test.ts` measures instead:
 *
 * 1. Who is allowed to fly. "off" flies nothing, "subtle" hops and stays, and
 *    a browser with no `offset-path` gets the hop as well.
 * 2. The layer never takes a click and never speaks.
 * 3. The perch is hidden while the bird is out and shown again however the
 *    flight ends.
 * 4. Escape and a route change end it.
 *
 * jsdom runs no animations, so `onAnimationComplete` never fires by itself
 * and the overlay stays up until something cancels it. That is what makes
 * assertions 3 and 4 observable here.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  CorvidFlight,
  PERCH_ATTRIBUTE,
} from "../../src/components/brand/CorvidFlight";
import { flyCorvid } from "../../src/lib/corvid";
import { HOP_CLASS } from "../../src/hooks/useCorvidIdle";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

/** A perch for the overlay to find, the size the sidebar renders. */
function mountPerch(): HTMLElement {
  const perch = document.createElement("span");
  perch.setAttribute(PERCH_ATTRIBUTE, "");
  perch.getBoundingClientRect = () =>
    ({ left: 16, top: 24, width: 32, height: 32 }) as DOMRect;
  document.body.append(perch);
  return perch;
}

const overlay = () => document.querySelector("[data-corvid-flight]");

const fly = () => {
  act(() => {
    flyCorvid({ kind: "loop" });
    // The perch hops first, and the bird leaves when the hop is over.
    vi.advanceTimersByTime(200);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll(`[${PERCH_ATTRIBUTE}]`).forEach((n) => n.remove());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A way to change the route from inside the router, for the cancel test. */
const GoElsewhere = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/pulse")}>
      go
    </button>
  );
};

const mount = () =>
  render(
    <MemoryRouter>
      <CorvidFlight />
      <GoElsewhere />
    </MemoryRouter>,
  );

describe("CorvidFlight", () => {
  it("renders nothing until something asks the bird to fly", () => {
    mount();
    expect(overlay()).toBeNull();
  });

  it("puts the bird in a layer that takes no click and says nothing", () => {
    mountPerch();
    mount();
    fly();

    const layer = overlay()!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("z-[60]");
    expect(layer.className).toContain("fixed");
    // Under the contact overlay and the palette at z-100 and Modal at z-200.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("gives the bird an offset path in viewport pixels", () => {
    mountPerch();
    mount();
    fly();

    const bird = overlay()!.firstElementChild as HTMLElement;
    expect(bird.style.offsetPath).toMatch(/^path\("M32\.0 40\.0 C/);
    expect(bird.style.offsetRotate).toBe("auto");
    expect(bird.className).toContain("corvid-flying");
  });

  it("hides the perch while the bird is out", () => {
    const perch = mountPerch();
    mount();
    expect(perch.style.visibility).toBe("");
    fly();
    expect(perch.style.visibility).toBe("hidden");
  });

  it("gives the perch back when Escape lands the bird", () => {
    const perch = mountPerch();
    mount();
    fly();
    expect(overlay()).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(overlay()).toBeNull();
    expect(perch.style.visibility).toBe("");
  });

  it("gives the perch back when the app unmounts mid-flight", () => {
    const perch = mountPerch();
    const { unmount } = mount();
    fly();
    unmount();
    // The overlay went with the tree, and nothing is left hidden behind it.
    expect(overlay()).toBeNull();
    expect(perch.style.visibility).toBe("");
  });

  it("cancels the flight when the route changes", () => {
    const perch = mountPerch();
    mount();
    fly();
    expect(overlay()).not.toBeNull();

    // A new page is a new perch, and the rectangle the flight was built
    // from is stale the moment the layout changes.
    act(() => {
      screen.getByRole("button", { name: "go" }).click();
    });
    expect(overlay()).toBeNull();
    expect(perch.style.visibility).toBe("");
  });

  it("hops and stays home at the subtle level", () => {
    preferences.mascotMotion = "subtle";
    const perch = mountPerch();
    mount();

    act(() => {
      flyCorvid({ kind: "loop" });
    });
    expect(overlay()).toBeNull();
    expect(perch.classList.contains(HOP_CLASS)).toBe(true);
    expect(perch.style.visibility).toBe("");
  });

  it("does nothing at all when the level is off", () => {
    preferences.mascotMotion = "off";
    const perch = mountPerch();
    mount();
    fly();
    expect(overlay()).toBeNull();
    expect(perch.classList.contains(HOP_CLASS)).toBe(false);
  });

  it("is off when the Motion row asks for reduced motion", () => {
    preferences.motion = "reduced";
    const perch = mountPerch();
    mount();
    fly();
    expect(overlay()).toBeNull();
    expect(perch.classList.contains(HOP_CLASS)).toBe(false);
  });

  it("falls back to the hop where the browser ignores offset-path", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const perch = mountPerch();
    mount();

    // No wait here: the hop is the whole answer, and it is over in 120 ms.
    act(() => {
      flyCorvid({ kind: "loop" });
    });
    expect(overlay()).toBeNull();
    expect(perch.classList.contains(HOP_CLASS)).toBe(true);
    expect(perch.style.visibility).toBe("");
  });

  it("flies from a rectangle the caller passes instead of the perch", () => {
    mount();
    act(() => {
      flyCorvid({
        kind: "swoop",
        from: { left: 200, top: 300, width: 40, height: 40 } as DOMRect,
      });
      vi.advanceTimersByTime(200);
    });
    const bird = overlay()!.firstElementChild as HTMLElement;
    expect(bird.style.offsetPath).toMatch(/^path\("M220\.0 320\.0 C/);
  });
});
