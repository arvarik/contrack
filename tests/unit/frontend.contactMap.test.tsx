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
import type { MapContact } from "../../shared/geo";
import type { VisibleFeature } from "../../src/views/map/useClusterFeatures";

vi.mock("maplibre-gl", () => ({ addProtocol: vi.fn() }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("pmtiles", () => ({
  Protocol: class {
    tilev4 = vi.fn();
  },
}));
vi.mock("../../src/views/map/maplibreWorker", () => ({
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

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ mapStyles: null }),
}));
vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    mode: "light",
    preferences: { accent: "#006a91" },
  }),
}));

const visible = vi.fn<() => VisibleFeature[]>(() => []);
vi.mock("../../src/views/map/useClusterFeatures", () => ({
  useClusterFeatures: () => visible(),
}));

// Imported after the mocks, which is what vi.mock hoisting expects.
const { ContactMap } = await import("../../src/views/map/ContactMap");

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
  };

/** A MapLibre map as `onLoad` sees it: a container, and the two rotation handlers. */
function loadedMap(zoom = 1) {
  const container = document.createElement("div");
  const strip = document.createElement("details");
  strip.className =
    "maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show";
  strip.setAttribute("open", "");
  container.append(strip);
  return {
    strip,
    getContainer: () => container,
    touchZoomRotate: { disableRotation: vi.fn() },
    keyboard: { disableRotation: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    getSource: () => undefined,
    isStyleLoaded: () => true,
    getZoom: () => zoom,
    getLayer: () => undefined,
    getLayersOrder: () => [],
    moveLayer: vi.fn(),
  };
}

beforeEach(() => {
  visible.mockReturnValue([]);
  mapProps.mockClear();
  sourceProps.mockClear();
  layerProps.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ContactMap", () => {
  it("names the map as a region", () => {
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    expect(screen.getByRole("region", { name: "Contact map" })).toBeTruthy();
  });

  it("draws one named button per visible contact", () => {
    visible.mockReturnValue(PEOPLE.map(point));
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
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
    visible.mockReturnValue([
      {
        kind: "cluster",
        key: "cluster:7",
        clusterId: 7,
        count: 12,
        longitude: -0.12,
        latitude: 51.5,
      },
    ]);
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

  it("shows the card for the pin under the pointer", () => {
    visible.mockReturnValue([point(PEOPLE[0])]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    expect(screen.queryByText("London, UK")).toBeNull();
    fireEvent.pointerEnter(pin, { pointerType: "mouse" });
    expect(screen.getByText("London, UK")).toBeTruthy();
    fireEvent.pointerLeave(pin, { pointerType: "mouse" });
    expect(screen.queryByText("London, UK")).toBeNull();
  });

  it("opens no card for a finger, which cannot hover", () => {
    visible.mockReturnValue([point(PEOPLE[0])]);
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} />);
    const pin = screen.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    // A tap fires the enter and never the leave. The card would open under
    // the contact the tap opens and still be there when the contact closes.
    fireEvent.pointerEnter(pin, { pointerType: "touch" });
    expect(screen.queryByText("London, UK")).toBeNull();
    // Some browsers focus a tapped button. That focus is the tap's, not a
    // keyboard's, and opens nothing.
    fireEvent.pointerDown(pin, { pointerType: "touch" });
    fireEvent.focus(pin);
    expect(screen.queryByText("London, UK")).toBeNull();
    fireEvent.blur(pin);
    // Focus from a keyboard still opens it, on any device.
    fireEvent.focus(pin);
    expect(screen.getByText("London, UK")).toBeTruthy();
  });

  it("says it is still loading while the contacts load", () => {
    render(<ContactMap contacts={[]} onSelect={() => {}} loading />);
    expect(screen.getByText("Scanning geospatial data...")).toBeTruthy();
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
  // The heat reads the accent off the page, as the page paints it. jsdom
  // has no ResizeObserver, which the loaded map's resize path uses.
  beforeEach(() => {
    document.documentElement.style.setProperty("--color-primary", "#006a91");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    document.documentElement.style.removeProperty("--color-primary");
    vi.unstubAllGlobals();
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

  it("keeps the pins off the heat until it fades", async () => {
    visible.mockReturnValue(PEOPLE.map(point));
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} layer="heat" />);
    await screen.findByTestId("map");
    act(() => createdWith().onLoad({ target: loadedMap(5) }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("brings the pins back where the heat fades", async () => {
    visible.mockReturnValue(PEOPLE.map(point));
    render(<ContactMap contacts={PEOPLE} onSelect={() => {}} layer="heat" />);
    await screen.findByTestId("map");
    act(() => createdWith().onLoad({ target: loadedMap(8.5) }));
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
