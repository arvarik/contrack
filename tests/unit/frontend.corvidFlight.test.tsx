// @vitest-environment jsdom
/**
 * The flight overlay.
 *
 * `corvid.flight.test.ts` measures the routes. This measures what the
 * overlay does with one:
 *
 * 1. Who is allowed to fly. "off" flies nothing, "subtle" flutters on the
 *    perch and stays, and the Motion row's Reduced is "off".
 * 2. The layer never takes a click and never speaks.
 * 3. The perch's bird is hidden while it is out, and only the bird: the ring
 *    stays on screen, empty. However the flight ends, the bird comes back.
 * 4. It lands on its own: the flight ends, the overlay goes and the perch
 *    is the logo again.
 * 5. Escape, a route change and an unmount end it at once.
 *
 * Fake timers drive `requestAnimationFrame` and `performance.now` together,
 * so a whole flight can be flown in a test.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  CorvidFlight,
  PERCH_ATTRIBUTE,
  perchProps,
} from "../../src/components/brand/CorvidFlight";
import { CorvidMark } from "../../src/components/brand/CorvidMark";
import {
  CORVID_HOME_EVENT,
  CORVID_REACT_EVENT,
  flyCorvid,
} from "../../src/lib/corvid";
import { createRng } from "../../src/lib/corvidMotion";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

/** The sidebar's perch as the app renders it. */
const Perch = () => (
  <span {...perchProps} data-testid="perch" className="flex">
    <CorvidMark size={40} idPrefix="corvid" alive />
  </span>
);

const overlay = () => document.querySelector("[data-corvid-flight]");
const perchBird = () =>
  document.querySelector<SVGGElement>('[data-testid="perch"] [data-bird]')!;
const perchRing = () =>
  document.querySelector<SVGPathElement>(
    '[data-testid="perch"] [data-part="ring"]',
  )!;
const box = (left: number, top: number, size: number) =>
  ({
    left,
    top,
    width: size,
    height: size,
    right: left + size,
    bottom: top + size,
    x: left,
    y: top,
  }) as DOMRect;
const birdAt = () => {
  const holder = overlay()!.firstElementChild as HTMLElement;
  return /translate3d\(([-\d.]+)px, ([-\d.]+)px/
    .exec(holder.style.transform)!
    .slice(1)
    .map(Number);
};

/** A way to change the route from inside the router, for the cancel test. */
const GoElsewhere = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/pulse")}>
      go
    </button>
  );
};

const mount = () => {
  const result = render(
    <MemoryRouter>
      <Perch />
      <CorvidFlight />
      <GoElsewhere />
    </MemoryRouter>,
  );
  screen.getByTestId("perch").getBoundingClientRect = () => box(16, 12, 40);
  return result;
};

const fly = (kind: "loop" | "swoop" | "sortie" = "loop") => {
  act(() => {
    flyCorvid({ kind });
  });
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll(`[${PERCH_ATTRIBUTE}]`).forEach((n) => n.remove());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CorvidFlight", () => {
  it("renders nothing until something asks the bird to fly", () => {
    mount();
    expect(overlay()).toBeNull();
  });

  it("puts the bird in a layer that takes no click and says nothing", () => {
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

  it("hides the perch's bird while it is out, and never the ring", () => {
    mount();
    expect(perchBird().style.visibility).toBe("");
    fly();
    expect(perchBird().style.visibility).toBe("hidden");
    expect(perchRing().style.visibility).toBe("");
    advance(1_500);
    expect(perchRing().style.visibility).toBe("");
  });

  it("draws the flying bird without a ring of its own", () => {
    mount();
    fly();
    const layer = overlay()!;
    expect(layer.querySelector('[data-part="ring"]')).toBeNull();
    advance(500);
    expect(
      layer.querySelector('[data-part="head"]')!.getAttribute("d"),
    ).toMatch(/^M[\d.-]+ [\d.-]+ C/);
  });

  it("starts at the perch, then leaves it", () => {
    mount();
    fly();
    const [x0, y0] = birdAt();
    // The logo's body middle, at the perch: 16 + 0.56 * 40, 12 + 0.54 * 40.
    expect(x0).toBeCloseTo(38.4, 1);
    expect(y0).toBeCloseTo(33.6, 1);
    advance(1_200);
    expect(birdAt()[0]).toBeGreaterThan(x0 + 50);
  });

  it("lands by itself and gives the perch its bird back", () => {
    mount();
    fly();
    advance(12_000);
    expect(overlay()).toBeNull();
    expect(perchBird().style.visibility).toBe("");
  });

  it("gives the bird back when Escape lands it", () => {
    mount();
    fly();
    advance(400);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(overlay()).toBeNull();
    expect(perchBird().style.visibility).toBe("");
  });

  it("gives the bird back when the app unmounts mid-flight", () => {
    const { unmount } = mount();
    fly();
    const bird = perchBird();
    unmount();
    expect(overlay()).toBeNull();
    expect(bird.style.visibility).toBe("");
  });

  it("lands when the route changes", () => {
    mount();
    fly();
    act(() => {
      screen.getByRole("button", { name: "go" }).click();
    });
    expect(overlay()).toBeNull();
    expect(perchBird().style.visibility).toBe("");
  });

  it("comes home by a short way when asked again while out", () => {
    mount();
    fly();
    advance(1_500);
    fly();
    // Well inside a lap, the way home is over.
    advance(4_500);
    expect(overlay()).toBeNull();
  });

  it("flutters on the perch and stays at the subtle level", () => {
    preferences.mascotMotion = "subtle";
    mount();
    const asked: unknown[] = [];
    const listen = (e: Event) =>
      asked.push((e as CustomEvent).detail?.reaction);
    window.addEventListener(CORVID_REACT_EVENT, listen);
    fly();
    window.removeEventListener(CORVID_REACT_EVENT, listen);
    expect(overlay()).toBeNull();
    expect(asked).toEqual(["flutter"]);
    expect(perchBird().style.visibility).toBe("");
  });

  it("does nothing at all when the level is off", () => {
    preferences.mascotMotion = "off";
    mount();
    fly();
    expect(overlay()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is off when the Motion row asks for reduced motion", () => {
    preferences.motion = "reduced";
    mount();
    fly();
    expect(overlay()).toBeNull();
  });

  it("does not fly a lap when no perch is on screen", () => {
    mount();
    // Below `md` the sidebar's perch is in the DOM with no layout box.
    screen.getByTestId("perch").getBoundingClientRect = () => box(0, 0, 0);
    fly("loop");
    expect(overlay()).toBeNull();
  });

  it("swoops in from off screen when no perch is on screen, and hides nothing", () => {
    mount();
    screen.getByTestId("perch").getBoundingClientRect = () => box(0, 0, 0);
    fly("swoop");
    expect(birdAt()[0]).toBeLessThan(0);
    expect(perchBird().style.visibility).toBe("");
  });

  it("hears a second press only while the bird is out and on its way", () => {
    mount();
    fly();
    // Still leaving the ring: a press now would turn it round in the ring.
    advance(200);
    fly();
    advance(2_000);
    // The lap went on: two seconds in, it is far from home.
    expect(overlay()).not.toBeNull();
    const [x] = birdAt();
    expect(x).toBeGreaterThan(200);
  });

  it("lets nothing the app asks for by itself cut a lap short", () => {
    mount();
    fly();
    advance(1_500);
    fly("swoop");
    fly("sortie");
    // A way home would be over by now; the lap is not.
    advance(3_000);
    expect(overlay()).not.toBeNull();
    advance(9_000);
    expect(overlay()).toBeNull();
  });

  it("brings the bird home to the ring it left, whichever perch is pressed", () => {
    render(
      <MemoryRouter>
        <Perch />
        <span data-testid="preview" className="flex">
          <CorvidMark size={36} alive />
        </span>
        <CorvidFlight />
      </MemoryRouter>,
    );
    screen.getByTestId("perch").getBoundingClientRect = () => box(16, 12, 40);
    const preview = screen.getByTestId("preview");
    preview.getBoundingClientRect = () => box(1000, 500, 36);
    const previewBird = preview.querySelector<SVGGElement>("[data-bird]")!;
    act(() => {
      flyCorvid({ kind: "loop", perch: preview });
    });
    advance(1_500);
    // The sidebar's logo is pressed while the preview's bird is out.
    fly();
    expect(perchBird().style.visibility).toBe("");
    advance(8_000);
    expect(overlay()).toBeNull();
    expect(previewBird.style.visibility).toBe("");
  });

  it("starts the next flight even when the last one ended in the same moment", () => {
    mount();
    fly();
    advance(300);
    // A landing and a new flight in one batch: the new one must still run.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      flyCorvid({ kind: "loop" });
    });
    expect(overlay()).not.toBeNull();
    const [x0] = birdAt();
    advance(1_200);
    expect(birdAt()[0]).not.toBe(x0);
    advance(12_000);
    expect(overlay()).toBeNull();
    expect(perchBird().style.visibility).toBe("");
  });

  it("lands where the ring is now, if its page scrolled while the bird was out", () => {
    render(
      <MemoryRouter>
        <span data-testid="preview" className="flex">
          <CorvidMark size={36} alive />
        </span>
        <CorvidFlight />
      </MemoryRouter>,
    );
    const preview = screen.getByTestId("preview");
    preview.getBoundingClientRect = () => box(1000, 500, 36);
    act(() => {
      flyCorvid({ kind: "loop", perch: preview });
    });
    advance(1_000);
    // The page scrolls up by 120 px under the flying bird.
    preview.getBoundingClientRect = () => box(1000, 380, 36);
    let lastY = 0;
    for (let i = 0; i < 700 && overlay(); i++) {
      advance(16);
      if (overlay()) lastY = birdAt()[1]!;
    }
    expect(overlay()).toBeNull();
    // The logo's body middle at the new place: 380 + 0.54 * 36.
    expect(lastY).toBeCloseTo(380 + 0.54 * 36, 0);
  });

  it("rolls by turning the drawing and never by squashing it, so the pen keeps its width", () => {
    // A celebration pass rolls about one time in two. Fly them until one does.
    let upsideDown = false;
    for (let seed = 1; seed <= 12 && !upsideDown; seed++) {
      const random = vi
        .spyOn(Math, "random")
        .mockImplementation(createRng(seed));
      const { unmount } = mount();
      fly("swoop");
      for (let i = 0; i < 1_000 && overlay(); i++) {
        const holder = overlay()!.firstElementChild as HTMLElement;
        expect(holder.style.transform).not.toMatch(/scale/);
        // Upright, the eye is above the body's middle, at about 40. Upside
        // down, the rig has turned the points, and it is below, at about 64.
        const eye = overlay()!.querySelector('[data-part="eye"]')!;
        if (Number(eye.getAttribute("cy")) > 55) upsideDown = true;
        advance(16);
      }
      unmount();
      random.mockRestore();
    }
    expect(upsideDown).toBe(true);
  });

  it("tells the perch its bird is home when the app unmounts mid-flight", () => {
    const { unmount } = mount();
    const perch = screen.getByTestId("perch");
    fly();
    const homes: unknown[] = [];
    const listen = (e: Event) => homes.push((e as CustomEvent).detail?.perch);
    window.addEventListener(CORVID_HOME_EVENT, listen);
    unmount();
    window.removeEventListener(CORVID_HOME_EVENT, listen);
    expect(homes).toEqual([perch]);
  });

  it("leaves from a perch the caller names, and lands back on it", () => {
    render(
      <MemoryRouter>
        <Perch />
        <span data-testid="preview" className="flex">
          <CorvidMark size={36} alive />
        </span>
        <CorvidFlight />
      </MemoryRouter>,
    );
    screen.getByTestId("perch").getBoundingClientRect = () => box(16, 12, 40);
    const preview = screen.getByTestId("preview");
    preview.getBoundingClientRect = () => box(1000, 500, 36);
    const previewBird = preview.querySelector<SVGGElement>("[data-bird]")!;
    act(() => {
      flyCorvid({ kind: "loop", perch: preview });
    });
    expect(previewBird.style.visibility).toBe("hidden");
    expect(perchBird().style.visibility).toBe("");
    expect(birdAt()[0]).toBeCloseTo(1000 + 0.56 * 36, 1);
    advance(12_000);
    expect(overlay()).toBeNull();
    expect(previewBird.style.visibility).toBe("");
  });
});
