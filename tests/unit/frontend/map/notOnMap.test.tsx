// @vitest-environment jsdom
/**
 * The bottom line's count of contacts with an address and no pin, on a
 * stubbed `GET /api/geo/status`, and the list it opens.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotOnMapContact } from "../../../../shared/contracts/geo";
import { NotOnMap } from "../../../../src/views/map/NotOnMap";

const ROWAN: NotOnMapContact = {
  id: "c1",
  name: "Rowan Vale",
  company: "Northwind Partners",
  avatarUrl: null,
  location: "Lisbon, Portugal",
  isTracked: false,
  lat: null,
  lng: null,
  reason: "pending",
};
const SABLE: NotOnMapContact = {
  ...ROWAN,
  id: "c2",
  name: "Sable Quill",
  company: null,
  location: "Nowhere Lane, Atlantis",
  reason: "not-found",
};

function mount(contacts: NotOnMapContact[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ contacts })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSetLocation = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <NotOnMap onSetLocation={onSetLocation} />
    </QueryClientProvider>,
  );
  return { ...view, client, onSetLocation };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotOnMap", () => {
  it("shows nothing when every contact with an address has a pin", async () => {
    const { client, container } = mount([]);
    await waitFor(() =>
      expect(client.getQueryState(["geo", "status"])?.status).toBe("success"),
    );
    expect(container.textContent).toBe("");
  });

  it("counts the rest, says why for each, and opens the pin dialog", async () => {
    const { onSetLocation } = mount([ROWAN, SABLE]);

    fireEvent.click(
      await screen.findByRole("button", { name: "2 not on the map" }),
    );
    const list = screen.getByRole("dialog", { name: "Not on the map" });
    expect(within(list).getByText("Lisbon, Portugal")).toBeTruthy();
    expect(within(list).getByText("Waiting for the geocoder")).toBeTruthy();
    expect(
      within(list).getByText("The geocoder found no place for this address"),
    ).toBeTruthy();

    fireEvent.click(
      within(list).getByRole("button", {
        name: "Set location for Sable Quill",
      }),
    );
    expect(onSetLocation).toHaveBeenCalledWith(SABLE);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
