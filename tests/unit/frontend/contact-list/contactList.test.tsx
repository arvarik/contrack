// @vitest-environment jsdom
/**
 * The Network list when it fails to load, and what it draws again.
 *
 * A 500 hid the empty state and put nothing in its place, so the list was
 * blank: the connection banner speaks only when the server is out of reach.
 * And the rows were handed `navigate`, which is new on each change of path,
 * so opening a contact drew every row again.
 *
 * The real ContactList renders here. The API is stubbed.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Contact } from "../../../../src/types";

const contactsQuery = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("../../../../src/api", () => {
  // One result for every call: a mutation's functions keep one identity.
  const result = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  const mutation = () => result;
  return {
    useContacts: () => contactsQuery,
    useLists: () => ({ data: [] }),
    useCreateList: mutation,
    useReorderLists: mutation,
    useArchiveContact: mutation,
    useCreateContact: mutation,
    useParseContactText: mutation,
    useBulkDeleteContacts: mutation,
    useBulkRestoreContacts: mutation,
    useBulkUpdateContacts: mutation,
    useBulkAddToList: mutation,
  };
});
vi.mock("../../../../src/components/ImportModal", () => ({
  ImportModal: () => null,
}));
vi.mock("../../../../src/components/bulk/BulkModals", () => ({
  BulkModals: () => null,
}));
vi.mock("../../../../src/contexts/PreferencesContext", async () => {
  const { DEFAULT_PREFERENCES } =
    await import("../../../../src/api/preferences");
  return {
    usePreferences: () => ({
      preferences: DEFAULT_PREFERENCES,
      setPreference: vi.fn(),
      mode: "light",
    }),
  };
});
vi.mock("../../../../src/contexts/SessionContext", () => ({
  useRecent: () => ({ lastContactId: null, setLastContactId: vi.fn() }),
}));
/** Each row's wrapper calls this once per render. */
const rowRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../../src/hooks/useLongPress", () => ({
  useLongPress: () => {
    rowRenders.count += 1;
    return {};
  },
}));

import { ContactList } from "../../../../src/views/contact-list/ContactList";

afterEach(() => {
  cleanup();
  contactsQuery.data = undefined;
  contactsQuery.isError = false;
  contactsQuery.refetch.mockReset();
  rowRenders.count = 0;
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

/** Opens a contact the way the palette or a Pulse row does. */
function Opener() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/contact/c4")}>Open c4</button>;
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ContactList />
        <Opener />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the Network list", () => {
  it("says the contacts did not load, and Retry asks again", () => {
    contactsQuery.isError = true;
    mount();
    expect(
      screen.getByRole("heading", { name: "Your contacts did not load" }),
    ).toBeTruthy();
    expect(screen.queryByText("Your network is empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(contactsQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("draws only the rows that changed when a contact opens", () => {
    contactsQuery.data = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i + 1}`,
      name: `Person ${i + 1}`,
      isTracked: false,
      emails: [],
    })) as unknown as Contact[];
    // jsdom lays nothing out and has no scrollIntoView. A height lets the
    // virtualizer draw the rows.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
    Element.prototype.scrollIntoView = vi.fn();
    mount();
    expect(screen.getAllByRole("link", { name: /^Person/ })).toHaveLength(6);
    rowRenders.count = 0;
    fireEvent.click(screen.getByRole("button", { name: "Open c4" }));
    // The row that opens, and the row that gives up the Tab stop.
    expect(rowRenders.count).toBeLessThanOrEqual(3);
  });
});
