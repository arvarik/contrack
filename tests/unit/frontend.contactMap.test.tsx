// @vitest-environment jsdom
/**
 * The map's markers, without a map.
 *
 * MapLibre needs WebGL, which jsdom does not have, so `react-map-gl/maplibre`
 * is replaced by components that render their children. What is left is the
 * part this app wrote: one named button per visible feature, a count button
 * for a cluster, and the click that opens a contact. The map itself is
 * exercised in the browser suite.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("react-map-gl/maplibre", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Map: Passthrough,
    Marker: Passthrough,
    Popup: Passthrough,
    Source: Passthrough,
    Layer: () => null,
    NavigationControl: () => null,
  };
});

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ mapStyles: null }),
}));
vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ mode: "light" }),
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

beforeEach(() => {
  visible.mockReturnValue([]);
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
    const button = screen.getByRole("button", { name: "12 contacts, zoom in" });
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
    fireEvent.mouseEnter(pin);
    expect(screen.getByText("London, UK")).toBeTruthy();
    fireEvent.mouseLeave(pin);
    expect(screen.queryByText("London, UK")).toBeNull();
  });

  it("says it is still loading while the contacts load", () => {
    render(<ContactMap contacts={[]} onSelect={() => {}} loading />);
    expect(screen.getByText("Scanning geospatial data...")).toBeTruthy();
  });
});
