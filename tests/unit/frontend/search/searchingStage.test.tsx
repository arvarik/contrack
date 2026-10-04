// @vitest-environment jsdom
/**
 * The Ask page's wait for AI: the stage and the search flight.
 *
 * `useCorvidSearchFlight` decides when the stage goes up, when the bird in
 * the search box flies out to hunt, and when it is called home. The flight
 * itself is the overlay's (`brand/corvidFlight.test.tsx`), so this file
 * listens to the events the hook sends it:
 *
 * 1. A quick answer shows nothing: no stage, no flight.
 * 2. A slow one puts up the stage after `STAGE_DELAY_MS` and sends the bird
 *    out `TAKEOFF_DELAY_MS` later, from the search box, into the page round
 *    the search column: the column is the flight's `avoid`, from the top of
 *    the search box down.
 * 3. The answer calls the bird home. The search box keeps its bird until
 *    the bird is back, so it has somewhere to land.
 * 4. At "subtle" and "off" nothing flies, and the stage holds a larger bird.
 *    So does a window with no room round the column to hunt in.
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
} from "../../../../src/lib/corvid";
import {
  STAGE_DELAY_MS,
  SearchingStage,
  TAKEOFF_DELAY_MS,
  useCorvidSearchFlight,
} from "../../../../src/views/search/SearchingStage";
import { CorvidMark } from "../../../../src/components/brand/CorvidMark";
import type {
  MascotMotion,
  MotionPreference,
} from "../../../../src/api/preferences";

const preferences = {
  mascotMotion: "full" as MascotMotion,
  motion: "system" as MotionPreference,
};

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences }),
}));

/** The page's use of the hook, cut down to the places it touches. */
const Page = ({
  searching,
  visible = true,
}: {
  searching: boolean;
  visible?: boolean;
}) => {
  const flight = useCorvidSearchFlight(searching);
  if (!visible) return null;
  return (
    <div ref={flight.pageRef} data-testid="page">
      <form ref={flight.fieldRef} data-testid="field">
        <span data-testid="box-glyph">
          {flight.perched ? (
            <span ref={flight.perchRef} data-testid="perch" className="flex">
              <CorvidMark size={20} />
            </span>
          ) : (
            "sparkles"
          )}
        </span>
      </form>
      {flight.staged && <SearchingStage still={flight.still} />}
    </div>
  );
};

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  }) as DOMRect;

/** The Ask page on a laptop: the page beside the nav rail, and its search box. */
const LAPTOP = {
  page: rect(64, 0, 1440, 900),
  field: rect(408, 102, 1096, 182),
  perch: rect(432, 132, 452, 152),
};
/**
 * A window with no room round the column: the page is the column's width
 * and the search box sits at the very top, so there is no margin beside it
 * and no band over it.
 */
const CRAMPED = {
  page: rect(0, 0, 400, 500),
  field: rect(8, 4, 392, 64),
  perch: rect(24, 24, 44, 44),
};
let layout = LAPTOP;

let flights: CorvidFlyDetail[] = [];
let recalls = 0;
const onFly = (e: Event) =>
  flights.push((e as CustomEvent<CorvidFlyDetail>).detail);
const onRecall = () => (recalls += 1);

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Give the page, the search box and its bird their boxes, then render. */
const mount = (searching: boolean) => {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.testid;
      return id === "page" || id === "field" || id === "perch"
        ? layout[id]
        : measure.call(this);
    },
  );
  return render(<Page searching={searching} />);
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
  layout = LAPTOP;
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

  it("puts up the stage, then sends the bird out of the search box to hunt round the column", () => {
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
    // The page beside the nav rail is where it may go.
    expect(flight!.area).toEqual({
      left: 64,
      top: 0,
      right: 1440,
      bottom: 900,
    });
    // The column it keeps out of: the search box's sides, from its top
    // down past the bottom of the window, where the results will be.
    expect(flight!.avoid).toEqual({
      left: 408,
      top: 102,
      right: 1096,
      bottom: 900,
    });
  });

  it("keeps the bird home when there is no room round the column, and the stage holds a larger bird", () => {
    layout = CRAMPED;
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 500);
    mount(true);
    // Measured before the first paint: the box never shows the bird.
    expect(screen.queryByTestId("perch")).toBeNull();
    expect(screen.getByTestId("box-glyph").textContent).toBe("sparkles");
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS + 1_000);
    expect(flights).toEqual([]);
    const bird = stage()!.querySelector("svg")!;
    expect(bird.getAttribute("width")).toBe("64");
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

  it("clears the departed state when Notes removes the search box before landing", () => {
    const { rerender } = mount(true);
    advance(STAGE_DELAY_MS + TAKEOFF_DELAY_MS);
    const perch = screen.getByTestId("perch");
    tell(CORVID_AWAY_EVENT, perch);
    rerender(<Page searching={false} visible={false} />);
    expect(recalls).toBe(1);
    tell(CORVID_HOME_EVENT, perch);
    rerender(<Page searching={false} />);
    expect(screen.queryByTestId("perch")).toBeNull();
    expect(screen.getByTestId("box-glyph").textContent).toBe("sparkles");
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
