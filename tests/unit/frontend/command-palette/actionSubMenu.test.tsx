// @vitest-environment jsdom
// =============================================================================
// The palette's action row for Track
// =============================================================================
// `→` on a result opens the actions for one contact. After Add to list sits
// Track, or Untrack, on the T key. It reads the flag from the contact cache,
// flips it with the same toast and Undo as the header button, and closes the
// palette. A ghost cannot be tracked, so it gets no row and T does nothing.
// =============================================================================
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
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({ fetch: vi.fn(), contacts: [] as unknown[] }));
vi.mock("../../../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/client")>()),
  apiFetch: (...args: unknown[]) => api.fetch(...args),
  // A hook names its route's contract: the request reaches `api.fetch` with
  // the contract's method, as it reaches the server.
  apiJson: async (
    route: { method: string },
    path: string,
    init?: RequestInit,
  ) => (await api.fetch(path, { ...init, method: route.method })).json(),
}));
vi.mock("../../../../src/api/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/contacts")>()),
  useContacts: () => ({ data: api.contacts, isLoading: false }),
}));

import { ActionSubMenu } from "../../../../src/components/command-palette/ActionSubMenu";

const ADA = {
  id: "ada",
  name: "Ada Lovelace",
  isTracked: false,
  isGhost: false,
  cadenceDays: 90,
};

function mount(contact = ADA) {
  api.contacts = [contact];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onCatchMeUp = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActionSubMenu
          contactId={contact.id}
          contactName={contact.name}
          contactAvatarUrl={null}
          onViewProfile={vi.fn()}
          onCatchMeUp={onCatchMeUp}
          onBack={vi.fn()}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, onCatchMeUp };
}

const lastBody = () =>
  JSON.parse((api.fetch.mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => {
  api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
    json: async () => ({ ...ADA, ...JSON.parse(init.body as string) }),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Track row", () => {
  it("sits after Add to list, on T, and reads Untrack for a tracked contact", () => {
    mount();
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    const list = rows.findIndex((text) => text?.includes("Add to list"));
    // The label, then the key hint.
    expect(rows[list + 1]).toBe("TrackT");
    cleanup();

    mount({ ...ADA, isTracked: true });
    expect(screen.getByRole("button", { name: /Untrack/ })).toBeTruthy();
  });

  it("tracks the contact and closes the palette", async () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Track/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));
    expect(api.fetch.mock.calls[0][0]).toBe("/contacts/ada");
    expect(lastBody()).toEqual({ isTracked: true });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(toastMock.success.mock.calls[0][0]).toBe(
      "Tracking Ada Lovelace, quarterly",
    );
  });

  it("answers the T key", async () => {
    const { onClose } = mount({ ...ADA, isTracked: true });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "t", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ isTracked: false });
  });

  it("gives a ghost no Track row, and T does nothing for it", async () => {
    const { onClose } = mount({ ...ADA, isGhost: true });
    expect(screen.queryByRole("button", { name: /Track/ })).toBeNull();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "t", bubbles: true }),
      );
    });
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

// → opens this menu while the palette's search box keeps the focus. The menu
// skipped every key typed in a field, so B typed a "b" into the box, and the
// typing closed the menu: no letter action worked from the keyboard.
describe("the keys, with focus in the palette's search box", () => {
  const pressIn = (
    field: HTMLElement,
    key: string,
    modifiers: KeyboardEventInit = {},
  ) => {
    document.body.appendChild(field);
    field.focus();
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...modifiers }),
      );
    });
  };

  it("answers B from the search box", () => {
    const { onCatchMeUp } = mount();
    const box = document.createElement("input");
    box.setAttribute("cmdk-input", "");
    pressIn(box, "b");
    expect(onCatchMeUp).toHaveBeenCalledTimes(1);
  });

  it("leaves a key with a modifier to the box, so ⌘C still copies", () => {
    const { onCatchMeUp } = mount();
    const box = document.createElement("input");
    box.setAttribute("cmdk-input", "");
    pressIn(box, "b", { metaKey: true });
    pressIn(box, "b", { ctrlKey: true });
    pressIn(box, "b", { altKey: true });
    expect(onCatchMeUp).not.toHaveBeenCalled();
  });

  it("leaves the keys of any other field alone", () => {
    const { onCatchMeUp } = mount();
    pressIn(document.createElement("input"), "b");
    pressIn(document.createElement("textarea"), "b");
    expect(onCatchMeUp).not.toHaveBeenCalled();
  });
});
