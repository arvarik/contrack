// @vitest-environment jsdom
// =============================================================================
// The contact page while it loads, when it fails, and as it renders again
// =============================================================================
// A contact opened on a blank "Loading contact..." although its row in the
// list already had the name, the picture, the role and the company. A timeout
// or a 500 said "Contact not found". And each render of the page drew the
// memoized header again, because it was handed new mutation objects.
//
// The real API hooks run here, over a stubbed `fetch`.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The composer is tiptap and the mini map is MapLibre. Neither is under test.
vi.mock("../../../../src/components/InteractionComposer", () => ({
  InteractionComposer: () => null,
}));
vi.mock("../../../../src/views/map/LocationMiniMap", () => ({
  LocationMiniMap: () => null,
}));
// The header's kebab reads the enrichment state, which the app provides.
vi.mock("../../../../src/contexts/AISearchContext", () => ({
  isEnriching: () => false,
  useAISearch: () => ({}),
  useOptionalAISearch: () => null,
}));
/** Each render of the header draws its Track button once. */
const trackButton = vi.hoisted(() => ({ renders: 0 }));
vi.mock("../../../../src/views/contact-detail/components/TrackButton", () => ({
  TrackButton: () => {
    trackButton.renders += 1;
    return null;
  },
}));

import { ContactProfile } from "../../../../src/views/contact-detail/components/ContactProfile";
import type { Contact } from "../../../../src/types";

const ROW = {
  id: "c1",
  name: "Ada Lovelace",
  role: "Analyst",
  company: "Engines Ltd",
  avatarUrl: null,
  themeColor: "brand",
  isTracked: false,
  isGhost: false,
  emails: [],
  phones: [],
  tags: [],
  lists: [],
} as unknown as Contact;

const FULL = {
  ...ROW,
  socialLinks: [],
  addresses: [],
  interests: [],
  attributes: [],
  experience: [],
  education: [],
  sources: [],
} as unknown as Contact;

/** Answer `/contacts/c1` with `contact`, and every other read with nothing. */
function stubFetch(contact: () => Promise<Response>) {
  const fetchMock = vi.fn((url: string) =>
    url === "/api/contacts/c1"
      ? contact()
      : Promise.resolve(Response.json(url.endsWith("/timeline") ? [] : {})),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["contacts"], [ROW]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/contact/c1"]}>
        <ContactProfile contactId="c1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  trackButton.renders = 0;
});

describe("the contact page", () => {
  it("draws the header from the list row while the contact loads", () => {
    stubFetch(() => new Promise(() => {}));
    const client = mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeTruthy();
    expect(screen.getByText("Analyst · Engines Ltd")).toBeTruthy();
    // The row is drawn, never stored as the full contact.
    expect(client.getQueryData(["contacts", "c1"])).toBeUndefined();
  });

  it("offers Retry when the contact fails to load, and says not found for a 404", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(Response.json({ error: "boom" }, { status: 500 })),
    );
    mount();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText("Contact not found")).toBeNull();

    // Retry asks again, and this time the contact is gone.
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ error: "gone" }, { status: 404 })),
    );
    fireEvent.click(retry);
    expect(await screen.findByText("Contact not found")).toBeTruthy();
  });

  it("does not draw the header again when the page renders again", async () => {
    stubFetch(() => Promise.resolve(Response.json(FULL)));
    mount();
    await screen.findByRole("button", { name: "Contact actions" });
    const before = trackButton.renders;
    // The page is narrow in jsdom, so the sections are tabs.
    fireEvent.click(screen.getByRole("radio", { name: "Details" }));
    expect(
      screen
        .getByRole("radio", { name: "Details" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(trackButton.renders).toBe(before);
  });
});
