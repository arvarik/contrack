// @vitest-environment jsdom
/**
 * The map block on the contact page. `ContactMap` and the pin dialog are
 * stubbed, because the map needs WebGL and jsdom has none. A placed contact
 * gets a map on their pin, an address the geocoder has not placed gets a line
 * of text, neither gets nothing, and either of the first two can open the
 * dialog.
 *
 * Each contact page builds a new WebGL canvas, so two timing rules, pinned on
 * a fake clock in the "timing" block, keep that from showing:
 *
 *   1. The map is built only once the same pin holds still for SETTLE_MS.
 *   2. The placeholder holds until the map says it has loaded, and the map
 *      fades up through it.
 *
 * A check that no map is drawn proves nothing before that wait, so the two
 * such checks that are not about timing run on the fake clock too.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** The props the map was asked for, and the hook it reports loading with. */
const mapProps = vi.fn();
let reportReady: (() => void) | null = null;
vi.mock("../../../../src/views/map/ContactMap", () => ({
  ContactMap: (
    props: Record<string, unknown> & { onMapReady?: (map: unknown) => void },
  ) => {
    mapProps(props);
    reportReady = () => props.onMapReady?.({});
    return <div data-testid="contact-map" />;
  },
}));

const modalProps = vi.fn();
vi.mock("../../../../src/views/map/AdjustPinModal", () => ({
  AdjustPinModal: (props: Record<string, unknown>) => {
    modalProps(props);
    return <div data-testid="adjust-pin-modal" />;
  },
}));

const { LocationMiniMap, SETTLE_MS } =
  await import("../../../../src/views/map/LocationMiniMap");

const ADA = {
  id: "c1",
  name: "Ada Lovelace",
  company: "Babbage & Co",
  avatarUrl: null,
  location: "London, UK",
  isTracked: false,
  lat: 51.5074,
  lng: -0.1278,
  geoSource: null as "geocoder" | "manual" | null,
};

type Drawn =
  typeof ADA | (Omit<typeof ADA, "lat" | "lng"> & { lat: null; lng: null });

const draw = (contact: Drawn, hasAddress: boolean) =>
  render(
    <MemoryRouter>
      <LocationMiniMap contact={contact} hasAddress={hasAddress} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  mapProps.mockClear();
  modalProps.mockClear();
});

describe("LocationMiniMap", () => {
  // Where the contact would cover the whole map, the link shows the pin.
  it.each([
    [true, "/map/contact/c1"],
    [false, "/map"],
  ])(
    "draws the contact's pin and a way to the map (room beside it: %s)",
    async (roomy, href) => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: roomy && query.includes("min-width"),
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      draw(ADA, true);
      expect(await screen.findByTestId("contact-map")).toBeTruthy();
      const link = screen.getByRole("link", { name: "Open in map" });
      expect(link.getAttribute("href")).toBe(href);
      vi.unstubAllGlobals();
    },
  );

  it("opens the map on the contact, still, and with no card", async () => {
    draw(ADA, true);
    await screen.findByTestId("contact-map");
    const props = mapProps.mock.calls[0][0];
    // The pin carries what the map draws, and not who placed it.
    expect(props.contacts).toEqual([
      {
        id: ADA.id,
        name: ADA.name,
        company: ADA.company,
        avatarUrl: null,
        location: ADA.location,
        isTracked: ADA.isTracked,
        lat: ADA.lat,
        lng: ADA.lng,
      },
    ]);
    expect(props.initialView).toEqual({
      longitude: ADA.lng,
      latitude: ADA.lat,
      zoom: 11,
    });
    expect(props.interactive).toBe(false);
    expect(props.hoverCard).toBe(false);
    // A second map on the page is a second landmark, and two landmarks with
    // one name are two the reader cannot tell apart.
    expect(props.label).toBe("Location map");
  });

  it("draws nothing for a contact with no address and no pin", () => {
    const { container } = draw({ ...ADA, lat: null, lng: null }, false);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("contact-map")).toBeNull();
  });

  it("opens the dialog from Adjust pin, on this contact, and closes it again", async () => {
    draw(ADA, true);
    expect(screen.queryByTestId("adjust-pin-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Adjust pin" }));

    expect(await screen.findByTestId("adjust-pin-modal")).toBeTruthy();
    const props = modalProps.mock.calls[0][0] as {
      contact: typeof ADA;
      hasAddress: boolean;
      isOpen: boolean;
      onClose: () => void;
    };
    expect(props.contact).toBe(ADA);
    // The page's own answer, so an address row with no `location` counts.
    expect(props.hasAddress).toBe(true);
    expect(props.isOpen).toBe(true);

    props.onClose();
    await vi.waitFor(() =>
      expect(screen.queryByTestId("adjust-pin-modal")).toBeNull(),
    );
  });

  it("opens the same dialog from Set location", async () => {
    draw({ ...ADA, lat: null, lng: null }, true);
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));
    expect(await screen.findByTestId("adjust-pin-modal")).toBeTruthy();
  });

  it("says when a person placed the pin, and only then", async () => {
    draw(ADA, true);
    await screen.findByTestId("contact-map");
    expect(screen.queryByText("Placed by hand")).toBeNull();
    cleanup();

    draw({ ...ADA, geoSource: "manual" }, true);
    await screen.findByTestId("contact-map");
    expect(screen.getByText("Placed by hand")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "About Placed by hand" }),
    ).toBeTruthy();
  });

  describe("timing", () => {
    /**
     * Move time on by `ms` and let React finish. The map is behind
     * `React.lazy`, which resolves in a microtask, so the flush follows the
     * clock. `waitFor` would poll on the same fake clock.
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

    it("builds no map until the pin has held still", async () => {
      draw(ADA, true);

      // The caption is there from the first frame. The map is not.
      expect(screen.getByRole("link", { name: "Open in map" })).toBeTruthy();
      expect(screen.queryByTestId("contact-map")).toBeNull();

      await tick(SETTLE_MS - 1);
      expect(screen.queryByTestId("contact-map")).toBeNull();

      await tick(1);
      expect(screen.getByTestId("contact-map")).toBeTruthy();
    });

    it("builds nothing at all for a contact that is passed through", async () => {
      const { rerender } = draw(ADA, true);
      await tick(SETTLE_MS - 1);

      // On to the next person a moment before Ada's wait is over. Her wait
      // must not build a map for the next pin.
      const grace = {
        ...ADA,
        id: "c2",
        name: "Grace Hopper",
        company: "US Navy",
        location: "Arlington, VA",
        lat: 38.8799,
        lng: -77.1067,
      };
      rerender(
        <MemoryRouter>
          <LocationMiniMap contact={grace} hasAddress />
        </MemoryRouter>,
      );
      await tick(1);
      expect(screen.queryByTestId("contact-map")).toBeNull();

      await settle();
      expect(screen.getByTestId("contact-map")).toBeTruthy();
    });

    it("starts the wait again when the pin moves", async () => {
      const { rerender } = draw(ADA, true);
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
      draw(ADA, true);
      await settle();

      const fader = () =>
        screen.getByTestId("contact-map").closest("[class*='opacity-']");
      expect(fader()?.className).toContain("opacity-0");

      await act(async () => {
        reportReady?.();
      });
      expect(fader()?.className).toContain("opacity-100");
    });

    it("says an address the geocoder has not placed is not on the map", async () => {
      draw({ ...ADA, lat: null, lng: null }, true);
      expect(screen.getByText("Not on the map yet")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Set location" })).toBeTruthy();

      await tick(SETTLE_MS * 4);
      expect(screen.queryByTestId("contact-map")).toBeNull();
    });

    it("keeps the actions and drops the picture over the map page", async () => {
      render(
        <MemoryRouter initialEntries={["/map/contact/c1"]}>
          <LocationMiniMap
            contact={{ ...ADA, geoSource: "manual" }}
            hasAddress
          />
        </MemoryRouter>,
      );

      // The map behind the panel already holds the pin, so no second map and
      // no link to where the reader already is. A wrong pin is most visible
      // from there, so the way to fix it stays.
      expect(screen.getByRole("button", { name: "Adjust pin" })).toBeTruthy();
      expect(screen.getByText("Placed by hand")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Open in map" })).toBeNull();
      await tick(SETTLE_MS * 4);
      expect(screen.queryByTestId("contact-map")).toBeNull();
      expect(mapProps).not.toHaveBeenCalled();
    });
  });
});
