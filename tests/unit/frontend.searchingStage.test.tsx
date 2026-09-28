// @vitest-environment jsdom
/**
 * The Ask page's wait for AI: the stage and the search flight.
 *
 * `useCorvidSearchFlight` decides when the stage goes up, when the bird in
 * the search box flies out to hunt, and when it is called home. The flight
 * itself is the overlay's (`frontend.corvidFlight.test.tsx`), so this file
 * listens to the events the hook sends it:
 *
 * 1. A quick answer shows nothing: no stage, no flight.
 * 2. A slow one puts up the stage after `STAGE_DELAY_MS` and sends the bird
 *    out `TAKEOFF_DELAY_MS` later, from the search box, over the stage and
 *    the page below it.
 * 3. The answer calls the bird home. The search box keeps its bird until
 *    the bird is back, so it has somewhere to land.
 * 4. At "subtle" and "off" nothing flies, and the stage holds a larger bird.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  CORVID_AWAY_EVENT,
  CORVID_FLY_EVENT,
  CORVID_HOME_EVENT,
  CORVID_RECALL_EVENT,
  type CorvidFlyDetail,
} from "../../src/lib/corvid";
import {
  STAGE_DELAY_MS,
  SearchingStage,
  TAKEOFF_DELAY_MS,
  useCorvidSearchFlight,
} from "../../src/views/search/SearchingStage";
import { CorvidMark } from "../../src/components/brand/CorvidMark";
import type { MascotMotion, MotionPreference } from "../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

/** The page's use of the hook, cut down to the two places it touches. */
const Page = ({ searching }: { searching: boolean }) => {
  const flight = useCorvidSearchFlight(searching);
  return (
    <>
      <span data-testid="box-glyph">
        {flight.perched ? (
          <span ref={flight.perchRef} data-testid="perch" className="flex">
            <CorvidMark size={20} />
          </span>
        ) : (
          "sparkles"
        )}
      </span>
      {flight.staged && (
        <SearchingStage ref={flight.areaRef} still={flight.still} />
      )}
    </>
  );
};

const STAGE = {
  left: 296,
  top: 330,
  right: 1144,
  bottom: 618,
  width: 848,
  height: 288,
  x: 296,
  y: 330,
} as DOMRect;

let flights: CorvidFlyDetail[] = [];
let recalls = 0;
const onFly = (e: Event) =>
  flights.push((e as CustomEvent<CorvidFlyDetail>).detail);
const onRecall = () => (recalls += 1);

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Render, and give the stage a size as soon as it is in the page. */
const mount = (searching: boolean) => {
  const result = render(<Page searching={searching} />);
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.testid === "searching-stage"
        ? STAGE
        : measure.call(this);
    },
  );
  return result;
};

const stage = () => screen.queryByTestId("searching-stage");
const tell = (name: string, perch: Element) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(name, { detail: { perch } }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  preferences.mascotMotion = "full";
  preferences.motion = "system";
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  flights = [];
  recalls = 0;
  window.addEventListener(CORVID_FLY_EVENT, onFly);
  window.addEventListener(CORVID_RECALL_EVENT, onRecall);
});

afterEach(() => {
  window.removeEventListener(CORVID_FLY_EVENT, onFly);
  window.removeEventListener(CORVID_RECALL_EVENT, onRecall);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the wait for AI", () => {
  it("shows nothing for an answer that comes quickly", () => {
    const { rerender } = mount(true);
    advance(STAGE_DELAY_MS - 10);
    rerender(<Page searching={false} />);
    advance(1_000);
    expect(stage()).toBeNull();
    expect(flights).toEqual([]);
    expect(recalls).toBe(0);
    expect(screen.getByTestId("box-glyph").textContent).toBe("sparkles");
  });

  it("puts up the stage, then sends the bird out of the search box to hunt", () => {
    mount(true);
    // The search box shows the bird the flight leaves from.
    const perch = screen.getByTestId("perch");
    advance(STAGE_DELAY_MS);
    expect(stage()?.textContent).toContain("Searching your network…");
    expect(flights).toEqual([]);
    advance(TAKEOFF_DELAY_MS);
    expect(flights).toHaveLength(1);
    const [flight] = flights;
    expect(flight!.kind).toBe("search");
    expect(flight!.perch).toBe(perch);
    // Over the stage, and on down to the bottom of the window.
    expect(flight!.area).toEqual({
      left: 296,
      top: 330,
      right: 1144,
      bottom: 900,
    });
  });

  it("calls the bird home when the answer arrives, and keeps its perch till it lands", () => {
    const { rerender } = mount(true);
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS);
    const perch = screen.getByTestId("perch");
    tell(CORVID_AWAY_EVENT, perch);

    rerender(<Page searching={false} />);
    expect(recalls).toBe(1);
    // The answer is on screen and the stage is gone, but the bird is still
    // on its way: the search box keeps the perch it lands on.
    expect(stage()).toBeNull();
    expect(screen.getByTestId("perch")).toBe(perch);

    tell(CORVID_HOME_EVENT, perch);
    expect(screen.queryByTestId("perch")).toBeNull();
    expect(screen.getByTestId("box-glyph").textContent).toBe("sparkles");
  });

  it("does not call home a bird that never left", () => {
    const { rerender } = mount(true);
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS);
    rerender(<Page searching={false} />);
    expect(recalls).toBe(0);
    expect(screen.queryByTestId("perch")).toBeNull();
  });

  it("ignores another perch's comings and goings", () => {
    const { rerender } = mount(true);
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS);
    tell(CORVID_AWAY_EVENT, document.body);
    rerender(<Page searching={false} />);
    expect(recalls).toBe(0);
  });

  for (const level of ["subtle", "off"] as MascotMotion[]) {
    it(`flies nothing at ${level}, and the stage holds a larger bird`, () => {
      preferences.mascotMotion = level;
      mount(true);
      advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS + 1_000);
      expect(flights).toEqual([]);
      // The search box keeps its glyph: there is no flight to leave from.
      expect(screen.queryByTestId("perch")).toBeNull();
      const bird = stage()!.querySelector("svg")!;
      expect(bird.getAttribute("width")).toBe("64");
      expect(bird.getAttribute("aria-hidden")).toBe("true");
    });
  }

  it("counts the Motion row's Reduced as off", () => {
    preferences.motion = "reduced";
    mount(true);
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS + 1_000);
    expect(flights).toEqual([]);
    expect(stage()!.querySelector("svg")).not.toBeNull();
  });
});
