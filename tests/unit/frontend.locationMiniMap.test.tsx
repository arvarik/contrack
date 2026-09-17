// @vitest-environment jsdom
/**
 * The map block on the contact page, without a map.
 *
 * `ContactMap` is replaced here by a div that reports the props it was
 * given, because the map needs WebGL and jsdom has none, and the dialog that
 * moves the pin is replaced the same way. What is left is the decision this
 * component makes: a placed contact gets a map opened on their pin, a
 * contact with an address the geocoder has not placed gets a line of text,
 * a contact with neither gets nothing at all, and either of the first two
 * can open the dialog.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mapProps = vi.fn();
vi.mock("../../src/views/map/ContactMap", () => ({
  ContactMap: (props: Record<string, unknown>) => {
    mapProps(props);
    return <div data-testid="contact-map" />;
  },
}));

const modalProps = vi.fn();
vi.mock("../../src/views/map/AdjustPinModal", () => ({
  AdjustPinModal: (props: Record<string, unknown>) => {
    modalProps(props);
    return <div data-testid="adjust-pin-modal" />;
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
    // The pin carries what the map draws, and not who placed it.
    expect(props.contacts).toEqual([
      {
        id: ADA.id,
        name: ADA.name,
        company: ADA.company,
        avatarUrl: null,
        location: ADA.location,
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

  it("says an address the geocoder has not placed is not on the map", () => {
    draw({ ...ADA, lat: null, lng: null }, true);
    expect(screen.getByText("Not on the map yet")).toBeTruthy();
    expect(screen.queryByTestId("contact-map")).toBeNull();
    expect(screen.getByRole("button", { name: "Set location" })).toBeTruthy();
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
      isOpen: boolean;
      onClose: () => void;
    };
    expect(props.contact).toBe(ADA);
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

  it("keeps the actions and drops the picture over the map page", async () => {
    render(
      <MemoryRouter initialEntries={["/map/contact/c1"]}>
        <LocationMiniMap contact={{ ...ADA, geoSource: "manual" }} hasAddress />
      </MemoryRouter>,
    );

    // The map behind the panel already holds the pin, so no second map and
    // no link to where the reader already is. A wrong pin is most visible
    // from there, so the way to fix it stays.
    expect(screen.getByRole("button", { name: "Adjust pin" })).toBeTruthy();
    expect(screen.getByText("Placed by hand")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in map" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("contact-map")).toBeNull();
    expect(mapProps).not.toHaveBeenCalled();
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
});
