// @vitest-environment jsdom
// =============================================================================
// LocationMiniMap: the small map under a contact's address
// =============================================================================
// A contact page is built fresh for each person, so this map is a new WebGL
// canvas every time somebody moves down the list. Two rules keep that from
// showing, and both are timing, which is what this file pins down:
//
//   1. The map is built only once the same pin has held still for
//      SETTLE_MS. Pass through a person and nothing is built at all.
//   2. The placeholder holds until the map says it has loaded. The map fades
//      up through it, so the empty canvas is never on screen.
//
// ContactMap is mocked: this is about when it is asked for, not what it
// draws, and the real one wants WebGL.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  LocationMiniMap,
  SETTLE_MS,
  type MiniMapContact,
} from "../../src/views/map/LocationMiniMap";

/** The map the component asks for, and the hook it reports loading with. */
let reportReady: (() => void) | null = null;

vi.mock("../../src/views/map/ContactMap", () => ({
  ContactMap: ({ onMapReady }: { onMapReady?: (map: unknown) => void }) => {
    reportReady = () => onMapReady?.({});
    return <div data-testid="contact-map" />;
  },
}));

const ADA: MiniMapContact = {
  id: "ada",
  name: "Ada Lovelace",
  company: "Babbage & Co",
  avatarUrl: null,
  location: "London",
  isTracked: false,
  lat: 51.5072,
  lng: -0.1276,
};

function mount(contact: MiniMapContact = ADA) {
  return render(
    <MemoryRouter>
      <LocationMiniMap contact={contact} hasAddress />
    </MemoryRouter>,
  );
}

/**
 * Move time on by `ms` and let React finish.
 *
 * The map is behind `React.lazy`, which resolves in a microtask rather than
 * on a timer, so the flush has to follow the clock. `waitFor` is no use
 * here: it polls on the same fake clock this test is driving.
 */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

/** Push past the wait, and let the map's chunk arrive. */
const settle = () => tick(SETTLE_MS);

beforeEach(() => {
  vi.useFakeTimers();
  reportReady = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LocationMiniMap", () => {
  it("builds no map until the pin has held still", async () => {
    mount();

    // The caption is there from the first frame. The map is not.
    expect(screen.getByRole("link", { name: "Open in map" })).toBeTruthy();
    expect(screen.queryByTestId("contact-map")).toBeNull();

    await tick(SETTLE_MS - 1);
    expect(screen.queryByTestId("contact-map")).toBeNull();

    await tick(1);
    expect(screen.getByTestId("contact-map")).toBeTruthy();
  });

  it("builds nothing at all for a contact that is passed through", async () => {
    const { unmount } = mount();
    unmount();

    await tick(SETTLE_MS * 4);
    expect(screen.queryByTestId("contact-map")).toBeNull();
  });

  it("starts the wait again when the pin moves", async () => {
    const { rerender } = mount();
    await settle();
    expect(screen.getByTestId("contact-map")).toBeTruthy();

    // The same person, somewhere else: a new place to draw, a new wait.
    rerender(
      <MemoryRouter>
        <LocationMiniMap
          contact={{ ...ADA, lat: -33.8688, lng: 151.209 }}
          hasAddress
        />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(screen.queryByTestId("contact-map")).toBeNull();

    await settle();
    expect(screen.getByTestId("contact-map")).toBeTruthy();
  });

  it("holds the map clear until it reports that it has loaded", async () => {
    mount();
    await settle();

    const fader = () =>
      screen.getByTestId("contact-map").closest("[class*='opacity-']");
    expect(fader()?.className).toContain("opacity-0");

    await act(async () => {
      reportReady?.();
    });
    expect(fader()?.className).toContain("opacity-100");
  });

  it("says nothing about a map for a contact with no pin", async () => {
    render(
      <MemoryRouter>
        <LocationMiniMap
          contact={{ ...ADA, lat: null, lng: null }}
          hasAddress
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Not on the map yet")).toBeTruthy();

    await tick(SETTLE_MS * 4);
    expect(screen.queryByTestId("contact-map")).toBeNull();
  });
});
