// @vitest-environment jsdom
/**
 * The dialog that moves a pin, without a map.
 *
 * `ContactMap` is a div here that renders its children and hands the test
 * two of its callbacks: the click on the map, and the map itself once it is
 * ready. The marker is a div that hands over its drag handler. What is left
 * is the dialog's own logic: a pin that follows a click, a drag or an arrow
 * key, coordinates a person can read, a Save that is off until something
 * moved, and the two requests it makes.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface Position {
  longitude: number;
  latitude: number;
}

/** What the mocked map hands back to the test. */
const mapHandles: {
  onMapClick?: (at: Position) => void;
  onMapReady?: (map: unknown) => void;
  props?: Record<string, unknown>;
} = {};

vi.mock("../../src/views/map/ContactMap", () => ({
  ContactMap: (
    props: Record<string, unknown> & {
      children?: React.ReactNode;
      onMapClick?: (at: Position) => void;
      onMapReady?: (map: unknown) => void;
    },
  ) => {
    mapHandles.onMapClick = props.onMapClick;
    mapHandles.onMapReady = props.onMapReady;
    mapHandles.props = props;
    return <div data-testid="contact-map">{props.children}</div>;
  },
}));

const markerHandles: {
  onDragEnd?: (event: { lngLat: { lng: number; lat: number } }) => void;
  at?: { longitude: number; latitude: number };
} = {};

vi.mock("@vis.gl/react-maplibre", () => ({
  Marker: (props: {
    children?: React.ReactNode;
    longitude: number;
    latitude: number;
    onDragEnd?: (event: { lngLat: { lng: number; lat: number } }) => void;
  }) => {
    markerHandles.onDragEnd = props.onDragEnd;
    markerHandles.at = { longitude: props.longitude, latitude: props.latitude };
    return <div data-testid="marker">{props.children}</div>;
  },
}));

const { AdjustPinModal } = await import("../../src/views/map/AdjustPinModal");
const { formatPin, nudgeFor, NUDGE_PX, NUDGE_SHIFT_PX } =
  await import("../../src/views/map/AdjustPinModal");

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

/** A map whose screen is one pixel per hundredth of a degree. */
const FLAT_MAP = {
  project: ([lng, lat]: [number, number]) => ({ x: lng * 100, y: -lat * 100 }),
  unproject: ([x, y]: [number, number]) => ({ lng: x / 100, lat: -y / 100 }),
};

/** Stub `fetch`, answer with the contact the server would return, keep every request. */
function stubFetch() {
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, method: init?.method, body });
      const reply = {
        ...ADA,
        ...(body && "regeocode" in body
          ? { lat: null, lng: null, geoSource: null }
          : { lat: body?.lat, lng: body?.lng, geoSource: "manual" }),
      };
      return Promise.resolve(
        new Response(JSON.stringify(reply), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  return requests;
}

function mount(contact: typeof ADA, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdjustPinModal contact={contact} isOpen onClose={onClose} />
    </QueryClientProvider>,
  );
  return { client, onClose };
}

const coordinates = () =>
  screen.getByRole("status", { name: "Pin coordinates" }).textContent;

beforeEach(() => {
  mapHandles.onMapClick = undefined;
  mapHandles.onMapReady = undefined;
  markerHandles.onDragEnd = undefined;
  markerHandles.at = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the helpers", () => {
  it("writes a pin to five decimals, latitude first", () => {
    expect(formatPin({ latitude: 51.5074, longitude: -0.1278 })).toBe(
      "51.50740, -0.12780",
    );
  });

  it("turns an arrow key into a step, and Shift into a longer one", () => {
    expect(nudgeFor("ArrowUp", false)).toEqual({ dx: 0, dy: -NUDGE_PX });
    expect(nudgeFor("ArrowRight", true)).toEqual({ dx: NUDGE_SHIFT_PX, dy: 0 });
    expect(nudgeFor("Enter", false)).toBeNull();
  });
});

describe("AdjustPinModal", () => {
  it("opens on the contact's pin with Save off until something moves", () => {
    stubFetch();
    mount(ADA);

    expect(screen.getByRole("dialog", { name: "Adjust pin" })).toBeTruthy();
    expect(mapHandles.props?.initialView).toEqual({
      longitude: ADA.lng,
      latitude: ADA.lat,
      zoom: 11,
    });
    // No clustered contacts: the one pin is the dialog's own marker.
    expect(mapHandles.props?.contacts).toEqual([]);
    expect(markerHandles.at).toEqual({ longitude: ADA.lng, latitude: ADA.lat });
    expect(coordinates()).toBe("51.50740, -0.12780");
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Use address again" }),
    ).toBeTruthy();
  });

  it("moves the pin to a click on the map, and saves it there", async () => {
    const requests = stubFetch();
    const { onClose } = mount(ADA);

    act(() =>
      mapHandles.onMapClick?.({ longitude: 2.3522, latitude: 48.8566 }),
    );

    expect(markerHandles.at).toEqual({ longitude: 2.3522, latitude: 48.8566 });
    expect(coordinates()).toBe("48.85660, 2.35220");
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(save);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/contacts/c1/location");
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].body).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it("follows a drag", () => {
    stubFetch();
    mount(ADA);

    act(() =>
      markerHandles.onDragEnd?.({ lngLat: { lng: 12.4964, lat: 41.9028 } }),
    );

    expect(coordinates()).toBe("41.90280, 12.49640");
  });

  it("nudges the pin with the arrow keys, by pixels on the map", () => {
    stubFetch();
    mount(ADA);
    act(() => mapHandles.onMapReady?.(FLAT_MAP));
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });

    // Ten pixels up on the flat map is a tenth of a degree north.
    fireEvent.keyDown(pin, { key: "ArrowUp" });
    expect(markerHandles.at?.latitude).toBeCloseTo(ADA.lat + 0.1, 5);
    expect(markerHandles.at?.longitude).toBeCloseTo(ADA.lng, 5);

    // Shift and right: half a degree east.
    fireEvent.keyDown(pin, { key: "ArrowRight", shiftKey: true });
    expect(markerHandles.at?.longitude).toBeCloseTo(ADA.lng + 0.5, 5);

    // Any other key is somebody else's.
    fireEvent.keyDown(pin, { key: "Enter" });
    expect(markerHandles.at?.longitude).toBeCloseTo(ADA.lng + 0.5, 5);
  });

  it("takes focus on a pointer press, so a drag can be fine-tuned by key", () => {
    stubFetch();
    mount(ADA);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    expect(document.activeElement).not.toBe(pin);

    // MapLibre stops the press's default, which is where a button would
    // have taken focus. The pin takes it itself.
    fireEvent.pointerDown(pin);

    expect(document.activeElement).toBe(pin);
  });

  it("hands the pin back to the geocoder on request", async () => {
    const requests = stubFetch();
    const { onClose } = mount(ADA);

    fireEvent.click(screen.getByRole("button", { name: "Use address again" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests[0].body).toEqual({ regeocode: true });
  });

  it("writes the answer into the contact query and refreshes the map", async () => {
    stubFetch();
    const { client, onClose } = mount(ADA);
    client.setQueryData(["contacts", "map"], []);
    const invalidated = vi.spyOn(client, "invalidateQueries");

    act(() =>
      mapHandles.onMapClick?.({ longitude: 2.3522, latitude: 48.8566 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.getQueryData(["contacts", "c1"])).toMatchObject({
      id: "c1",
      lat: 48.8566,
      lng: 2.3522,
      geoSource: "manual",
    });
    const keys = invalidated.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["contacts", "map"]);
    expect(keys).toContainEqual(["contacts", "c1"]);
  });

  it("starts with no pin for a contact nobody has placed", () => {
    stubFetch();
    mount({
      ...ADA,
      lat: null as unknown as number,
      lng: null as unknown as number,
    });

    expect(screen.getByRole("dialog", { name: "Set location" })).toBeTruthy();
    expect(mapHandles.props?.initialView).toBeUndefined();
    expect(screen.queryByTestId("marker")).toBeNull();
    expect(coordinates()).toBe("No pin on the map yet");
    expect(
      screen.queryByRole("button", { name: "Use address again" }),
    ).toBeNull();

    act(() =>
      mapHandles.onMapClick?.({ longitude: 2.3522, latitude: 48.8566 }),
    );

    expect(screen.getByTestId("marker")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
