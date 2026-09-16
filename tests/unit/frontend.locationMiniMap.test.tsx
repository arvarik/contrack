// @vitest-environment jsdom
/**
 * The map block on the contact page, without a map.
 *
 * `ContactMap` is replaced here by a div that reports the props it was
 * given, because the map needs WebGL and jsdom has none. What is left is the
 * decision this component makes: a placed contact gets a map opened on their
 * pin, a contact with an address the geocoder has not placed gets a line of
 * text, and a contact with neither gets nothing at all.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mapProps = vi.fn();
vi.mock("../../src/views/map/ContactMap", () => ({
  ContactMap: (props: Record<string, unknown>) => {
    mapProps(props);
    return <div data-testid="contact-map" />;
  },
}));

const { LocationMiniMap } = await import("../../src/views/map/LocationMiniMap");

const ADA = {
  id: "c1",
  name: "Ada Lovelace",
  company: "Babbage & Co",
  avatarUrl: null,
  location: "London, UK",
  lat: 51.5074,
  lng: -0.1278,
};

const draw = (
  contact:
    typeof ADA | (Omit<typeof ADA, "lat" | "lng"> & { lat: null; lng: null }),
  hasAddress: boolean,
) =>
  render(
    <MemoryRouter>
      <LocationMiniMap contact={contact} hasAddress={hasAddress} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  mapProps.mockClear();
});

describe("LocationMiniMap", () => {
  it("draws the contact's pin and a way to the map page", async () => {
    draw(ADA, true);
    expect(await screen.findByTestId("contact-map")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open in map" });
    expect(link.getAttribute("href")).toBe("/map/contact/c1");
  });

  it("opens the map on the contact, still, and with no card", async () => {
    draw(ADA, true);
    await screen.findByTestId("contact-map");
    const props = mapProps.mock.calls[0][0];
    expect(props.contacts).toEqual([ADA]);
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

  it("says an address the geocoder has not placed is not on the map", () => {
    draw({ ...ADA, lat: null, lng: null }, true);
    expect(screen.getByText("Not on the map yet")).toBeTruthy();
    expect(screen.queryByTestId("contact-map")).toBeNull();
    const action = screen.getByRole("button", { name: "Set location" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws nothing for a contact with no address and no pin", () => {
    const { container } = draw({ ...ADA, lat: null, lng: null }, false);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("contact-map")).toBeNull();
  });
});
