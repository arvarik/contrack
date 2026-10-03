// @vitest-environment jsdom
/**
 * The map's markers, without a map.
 *
 * MapLibre needs WebGL, which jsdom does not have, so `@vis.gl/react-maplibre`
 * is replaced by components that render their children. What is left is the
 * part this app wrote: one named button per visible feature, a count button
 * for a cluster, and the click that opens a contact. The map itself is
 * exercised in the browser suite.
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
import type { MapContact } from "../../../../shared/geo";
import type { VisibleFeature } from "../../../../src/views/map/useClusterFeatures";

vi.mock("maplibre-gl", () => ({ addProtocol: vi.fn() }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("pmtiles", () => ({
  Protocol: class {
    tilev4 = vi.fn();
  },
}));
vi.mock("../../../../src/views/map/maplibreWorker", () => ({
  MAPLIBRE_WORKER_URL: "/assets/maplibre-worker.js",
}));

/** The props the map was created with, for the tests that read them. */
const mapProps = vi.fn<(props: Record<string, unknown>) => void>();
/** The sources and layers the map was given. */
const sourceProps = vi.fn<(props: Record<string, unknown>) => void>();
const layerProps = vi.fn<(props: Record<string, unknown>) => void>();

vi.mock("@vis.gl/react-maplibre", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Map = (
    props: Record<string, unknown> & { children?: React.ReactNode },
  ) => {
    mapProps(props);
    return <div data-testid="map">{props.children}</div>;
  };
  const Source = (
    props: Record<string, unknown> & { children?: React.ReactNode },
  ) => {
    sourceProps(props);
    return <div>{props.children}</div>;
  };
  const Layer = (props: Record<string, unknown>) => {
    layerProps(props);
    return null;
  };
  return {
    Map,
    Marker: Passthrough,
    Popup: Passthrough,
    Source,
    Layer,
    NavigationControl: () => null,
  };
});

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ mapStyles: null }),
}));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    mode: "light",
    preferences: { accent: "#006a91" },
  }),
}));

const visible = vi.fn<() => VisibleFeature[]>(() => []);
/** The map the pins were last read from. */
const featuresFrom = vi.fn<(map: unknown) => void>();
vi.mock("../../../../src/views/map/useClusterFeatures", () => ({
  useClusterFeatures: (map: unknown) => {
    featuresFrom(map);
    return visible();
  },
}));

// Imported after the mocks, which is what vi.mock hoisting expects.
const { ContactMap } = await import("../../../../src/views/map/ContactMap");
const { GRACE_MS, OPEN_MS } =
  await import("../../../../src/views/map/useHoverCard");

const person = (id: string, name: string, company: string): MapContact => ({
  id,
  name,
  company,
  avatarUrl: null,
  isTracked: true,
  location: "London, UK",
  lat: 51.5,
  lng: -0.12,
});

const PEOPLE = [
  person("c1", "Ada Lovelace", "Babbage & Co"),
  person("c2", "Grace Hopper", "US Navy"),
  person("c3", "Alan Turing", "NPL"),
];

const point = (contact: MapContact): VisibleFeature => ({
  kind: "point",
  key: `point:${contact.id}`,
  id: contact.id,
  longitude: contact.lng,
  latitude: contact.lat,
});

/** What the mocked map was last created with. */
const createdWith = () =>
  mapProps.mock.calls[mapProps.mock.calls.length - 1][0] as {
    initialViewState: {
      longitude: number;
      latitude: number;
      zoom: number;
      padding?: unknown;
    };
    reuseMaps?: boolean;
    onMoveEnd?: (event: { viewState: Record<string, number> }) => void;
    onLoad: (event: { target: unknown }) => void;
    onStyleData: (event: { target: unknown }) => void;
  };

/** A MapLibre map as `onLoad` sees it, one pixel a degree from (100, 100). */
function loadedMap(zoom = 1, source?: unknown) {
  const container = document.createElement("div");
  const canvas = document.createElement("div");
  const strip = document.createElement("details");
  strip.className =
    "maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show";
  strip.setAttribute("open", "");
  container.append(strip, canvas);
  return {
    strip,
    canvas,
    getContainer: () => container,
    getCanvasContainer: () => canvas,
    project: vi.fn(([lng, lat]: number[]) => ({ x: lng + 100, y: 100 - lat })),
    unproject: ([x, y]: number[]) => ({ lng: x - 100, lat: 100 - y }),
    touchZoomRotate: { disableRotation: vi.fn() },
    keyboard: { disableRotation: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    getSource: () => source,
    isStyleLoaded: () => true,
    getZoom: () => zoom,
    getLayer: () => undefined,
    getLayersOrder: () => [],
    moveLayer: vi.fn(),
  };
}

/** A contacts source whose one cluster holds these contacts. */
const sourceWith = (ids: string[]) => ({
  getClusterLeaves: async () => ids.map((id) => ({ properties: { id } })),
});

const cluster = (clusterId: number, count: number): VisibleFeature => ({
  kind: "cluster",
  key: `cluster:${clusterId}`,
  clusterId,
  count,
  longitude: -0.12,
  latitude: 51.5,
});

beforeEach(() => {
  visible.mockReturnValue([]);
  mapProps.mockClear();
  sourceProps.mockClear();
  layerProps.mockClear();
  window.localStorage.clear();
  // jsdom has no ResizeObserver, which the loaded map's resize path uses.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContactMap", () => {
  it("is a named region with one named button per visible contact", () => {
    visible.mockReturnValue(PEOPLE.map(point));
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    expect(screen.getByRole("region", { name: "Contact map" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Grace Hopper, US Navy" }),
    ).toBeTruthy();
  });

  it("draws nothing for a feature whose contact is gone", () => {
    visible.mockReturnValue([point(person("missing", "Nobody", "Nowhere"))]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("draws a cluster as a count button that says what a click does", () => {
    visible.mockReturnValue([cluster(7, 12)]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    const button = screen.getByRole("button", {
      name: "12 contacts, zoom in",
    });
    expect(button.textContent).toBe("12");
  });

  it("opens the contact a pin belongs to", () => {
    const onSelect = vi.fn();
    visible.mockReturnValue([point(PEOPLE[1])]);
    render(<ContactMap contacts={PEOPLE} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Grace Hopper, US Navy" }),
    );
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("opens a pin's card once the pointer rests, and keeps it while the pointer moves in", () => {
    vi.useFakeTimers();
    visible.mockReturnValue([point(PEOPLE[0])]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    fireEvent.pointerEnter(pin, { pointerType: "mouse" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.advanceTimersByTime(OPEN_MS));
    const card = screen.getByRole("dialog", { name: "Ada Lovelace" });

    fireEvent.pointerLeave(pin, { pointerType: "mouse" });
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(GRACE_MS));
    expect(
      screen.getByRole("button", { name: "Log interaction" }),
    ).toBeTruthy();
    fireEvent.pointerLeave(card);
    act(() => vi.advanceTimersByTime(GRACE_MS));
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.useRealTimers();
  });

  // A finger cannot hover: the first tap shows the card, the second opens.
  it("shows a finger's card first, and opens the contact on the second tap", () => {
    const onSelect = vi.fn();
    visible.mockReturnValue([point(PEOPLE[0])]);
    render(<ContactMap contacts={PEOPLE} onSelect={onSelect} />);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    const tap = () => {
      fireEvent.pointerDown(pin, { pointerType: "touch" });
      fireEvent.focus(pin);
      fireEvent.pointerUp(pin, { pointerType: "touch" });
      fireEvent.click(pin);
    };
    tap();
    expect(screen.getByRole("dialog", { name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    tap();
    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes a pinned card on Escape, and the pin's tooltip stays shut", () => {
    vi.useFakeTimers();
    visible.mockReturnValue([point(PEOPLE[0])]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    act(() => pin.focus());
    act(() => vi.advanceTimersByTime(OPEN_MS));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(pin, { key: " " });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Open contact",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(pin);
    act(() => vi.advanceTimersByTime(OPEN_MS * 2));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.useRealTimers();
  });

  it("pins a requested card, gives focus back to its asker, and asks again for a new request", () => {
    visible.mockReturnValue([point(PEOPLE[0])]);
    // Every render brings new contacts, which must not ask again.
    const view = (request: { id: string } | null) => (
      <>
        <button type="button">Row</button>
        <ContactMap
          contacts={[...PEOPLE]}
          onSelect={() => {}}
          cardRequest={request}
        />
      </>
    );
    const { rerender } = render(view(null));
    const row = screen.getByRole("button", { name: "Row" });
    act(() => row.focus());
    const request = { id: "c1" };
    rerender(view(request));
    expect(screen.getByRole("dialog", { name: "Ada Lovelace" })).toBeTruthy();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Open contact",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
    rerender(view(request));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view({ id: "c1" }));
    expect(screen.getByRole("dialog", { name: "Ada Lovelace" })).toBeTruthy();
  });

  it("rings the open contact with a halo, and dims the others", async () => {
    visible.mockReturnValue([point(PEOPLE[0]), cluster(7, 2)]);
    const view = (selectedId: string) => (
      <ContactMap
        contacts={PEOPLE}
        onSelect={() => {}}
        selectedId={selectedId}
      />
    );
    const { rerender } = render(view("c1"));
    await screen.findByTestId("map");
    act(() =>
      createdWith().onLoad({ target: loadedMap(1, sourceWith(["c2", "c3"])) }),
    );
    const ada = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    const stack = screen.getByRole("button", { name: "2 contacts, zoom in" });
    await waitFor(() => expect(stack.dataset.dimmed).toBe("true"));
    expect(ada.dataset.halo).toBe("true");

    // A stack that holds the open contact wears the halo for them.
    rerender(view("c3"));
    expect(stack.dataset.halo).toBe("true");
    expect(stack.dataset.dimmed).toBeUndefined();
    expect(ada.dataset.dimmed).toBe("true");
  });

  it("rings the pin a list row points at, and the pin whose card is open", () => {
    visible.mockReturnValue(PEOPLE.map(point));
    render(
      <ContactMap contacts={PEOPLE} onSelect={() => {}} highlightedId="c2" />,
    );
    const pin = (name: string) => screen.getByRole("button", { name });
    expect(pin("Grace Hopper, US Navy").dataset.halo).toBe("true");
    const ada = pin("Ada Lovelace, Babbage & Co");
    expect(ada.dataset.halo).toBeUndefined();
    fireEvent.pointerDown(ada, { pointerType: "touch" });
    fireEvent.pointerUp(ada, { pointerType: "touch" });
    expect(screen.getByRole("dialog", { name: "Ada Lovelace" })).toBeTruthy();
    expect(ada.dataset.halo).toBe("true");
    // Nobody is open, so no pin steps back.
    expect(pin("Alan Turing, NPL").dataset.dimmed).toBeUndefined();
  });

  it("marks an overdue follow-up with a dot that the pin's description names", () => {
    const late = { ...PEOPLE[0], nextFollowUpAt: "2020-01-01" };
    visible.mockReturnValue([point(late), point(PEOPLE[1])]);
    render(<ContactMap contacts={[late, PEOPLE[1]]} onSelect={() => {}} />);
    expect(
      screen.getByRole("button", {
        name: "Ada Lovelace, Babbage & Co",
        description: "Follow-up overdue",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Grace Hopper, US Navy" })
        .hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  it("clusters the source's last zoom, so people on one point stay one stack", async () => {
    // Past the last clustered zoom, people on one point were pins on top of
    // each other, and only the top one could be clicked.
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    await screen.findByTestId("map");
    const source = sourceProps.mock.calls
      .map(([props]) => props)
      .find((props) => props.id === "contacts");
    expect(source).toMatchObject({ maxzoom: 18, clusterMaxZoom: 18 });
  });

  it("says the contacts are loading while they load", () => {
    render(<ContactMap contacts={[]} onSelect={() => {}} loading />);
    expect(screen.getByText("Loading contacts…")).toBeTruthy();
  });

  it("is born on the default view, and keeps no map, unless asked", async () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    await screen.findByTestId("map");
    const props = createdWith();
    expect(props.initialViewState.longitude).toBe(-95);
    expect(props.initialViewState.latitude).toBe(20);
    expect(props.reuseMaps).toBe(false);
    expect(props.onMoveEnd).toBeUndefined();
  });

  it("opens on the view it was left at, and remembers every move", async () => {
    window.localStorage.setItem(
      "contrack.map.lastView",
      JSON.stringify({ longitude: -0.1278, latitude: 51.5074, zoom: 11 }),
    );
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} rememberView />);
    await screen.findByTestId("map");
    const props = createdWith();
    expect(props.initialViewState).toMatchObject({
      longitude: -0.1278,
      latitude: 51.5074,
      zoom: 11,
    });

    props.onMoveEnd?.({
      viewState: { longitude: 2.3522, latitude: 48.8566, zoom: 12 },
    });
    expect(
      JSON.parse(window.localStorage.getItem("contrack.map.lastView") ?? ""),
    ).toEqual({ longitude: 2.3522, latitude: 48.8566, zoom: 12 });
  });

  it("lets a caller's view win over the remembered one", async () => {
    window.localStorage.setItem(
      "contrack.map.lastView",
      JSON.stringify({ longitude: -0.1278, latitude: 51.5074, zoom: 11 }),
    );
    render(
      <ContactMap
        contacts={PEOPLE}
        onSelect={() => {}}
        rememberView
        initialView={{ longitude: 139.65, latitude: 35.68, zoom: 9 }}
      />,
    );
    await screen.findByTestId("map");
    expect(createdWith().initialViewState).toMatchObject({
      longitude: 139.65,
      latitude: 35.68,
    });
  });

  it("is born with the padding it is given, and kept when asked", async () => {
    const padding = { top: 0, right: 860, bottom: 0, left: 0 };
    render(
      <ContactMap
        contacts={PEOPLE}
        onSelect={() => {}}
        initialPadding={padding}
        reuse
      />,
    );
    await screen.findByTestId("map");
    const props = createdWith();
    expect(props.initialViewState.padding).toEqual(padding);
    expect(props.reuseMaps).toBe(true);
  });

  it("collapses the attribution and stops rotation once the map has loaded", async () => {
    const onMapReady = vi.fn();
    render(
      <ContactMap
        contacts={PEOPLE}
        onSelect={() => {}}
        onMapReady={onMapReady}
      />,
    );
    await screen.findByTestId("map");
    const map = loadedMap();

    createdWith().onLoad({ target: map });

    expect(map.strip.classList.contains("maplibregl-compact-show")).toBe(false);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard.disableRotation).toHaveBeenCalledOnce();
    expect(onMapReady).toHaveBeenCalledWith(map);
  });

  it("leaves rotation alone on a still map, which has no handlers to stop", async () => {
    render(
      <ContactMap contacts={PEOPLE} onSelect={() => {}} interactive={false} />,
    );
    await screen.findByTestId("map");
    const map = loadedMap();
    createdWith().onLoad({ target: map });
    expect(map.touchZoomRotate.disableRotation).not.toHaveBeenCalled();
  });
});

describe("the heat layer", () => {
  // The heat reads the accent off the page, as the page paints it.
  beforeEach(() => {
    document.documentElement.style.setProperty("--color-primary", "#006a91");
  });
  afterEach(() => {
    document.documentElement.style.removeProperty("--color-primary");
  });

  it("reads its own unclustered copy of the contacts", async () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} layer="heat" />);
    await waitFor(() =>
      expect(
        layerProps.mock.calls.some(([props]) => props.type === "heatmap"),
      ).toBe(true),
    );
    // A cluster is one point to a heatmap, so twelve people in a city
    // added what one person added.
    const heat = sourceProps.mock.calls
      .map(([props]) => props)
      .find((props) => props.id === "contacts-heat")!;
    expect(heat.cluster).toBeUndefined();
    expect(
      (heat.data as { features: unknown[] }).features.map(
        (feature) => (feature as { id: string }).id,
      ),
    ).toEqual(["c1", "c2", "c3"]);
    const layer = layerProps.mock.calls
      .map(([props]) => props)
      .find((props) => props.type === "heatmap")!;
    expect(layer.maxzoom).toBe(9);
  });

  it("draws no heat while the pins are on", async () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    await screen.findByTestId("map");
    expect(
      sourceProps.mock.calls.some(([props]) => props.id === "contacts-heat"),
    ).toBe(false);
  });

  it.each([
    [5, 0],
    [8.5, 3],
  ])(
    "keeps the pins off the heat until it fades: at zoom %s, %s pins",
    async (zoom, pins) => {
      visible.mockReturnValue(PEOPLE.map(point));
      render(<ContactMap contacts={PEOPLE} onSelect={() => {}} layer="heat" />);
      await screen.findByTestId("map");
      act(() => createdWith().onLoad({ target: loadedMap(zoom) }));
      expect(screen.queryAllByRole("button")).toHaveLength(pins);
    },
  );

  it("says about how many people are by a mouse while the pins are off", async () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} layer="heat" />);
    await screen.findByTestId("map");
    const map = loadedMap(5);
    act(() => createdWith().onLoad({ target: map }));
    // Three moves in one frame are one read, which projects each person once.
    for (const clientX of [90, 95, 100])
      fireEvent.pointerMove(map.canvas, {
        pointerType: "mouse",
        clientX,
        clientY: 48,
      });
    expect(await screen.findByText("About 3 people here")).toBeTruthy();
    expect(map.project).toHaveBeenCalledTimes(3);

    // A finger is not followed, and the count goes when the mouse leaves.
    fireEvent.pointerMove(map.canvas, { pointerType: "touch", clientX: 0 });
    await act(() => new Promise((done) => requestAnimationFrame(done)));
    expect(screen.getByText("About 3 people here")).toBeTruthy();
    fireEvent.pointerLeave(map.canvas);
    await waitFor(() => expect(screen.queryByText(/people here/)).toBeNull());
  });
});

describe("the pins before the basemap", () => {
  // MapLibre's load waits for every basemap tile and font, which on a first
  // visit over a slow link took seconds. The pins need only the contacts
  // source, and the map has it once its style has arrived.
  it("reads the pins once the style has data, before the map loads", async () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    await screen.findByTestId("map");
    expect(featuresFrom).toHaveBeenLastCalledWith(null);
    const map = loadedMap();
    act(() => createdWith().onStyleData({ target: map }));
    expect(featuresFrom).toHaveBeenLastCalledWith(map);
  });
});
