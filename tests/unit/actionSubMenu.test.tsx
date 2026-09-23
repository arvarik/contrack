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
vi.mock("../../src/api/client", () => ({
  apiFetch: (...args: unknown[]) => api.fetch(...args),
}));
vi.mock("../../src/api/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/contacts")>()),
  useContacts: () => ({ data: api.contacts, isLoading: false }),
}));

import { ActionSubMenu } from "../../src/components/command-palette/ActionSubMenu";

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
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActionSubMenu
          contactId={contact.id}
          contactName={contact.name}
          contactAvatarUrl={null}
          onViewProfile={vi.fn()}
          onCatchMeUp={vi.fn()}
          onBack={vi.fn()}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose };
}

const lastBody = () =>
  JSON.parse((api.fetch.mock.calls.at(-1)?.[1] as RequestInit).body as string);

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
    const { unmount } = { unmount: mount().onClose };
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    const list = rows.findIndex((text) => text?.includes("Add to list"));
    expect(rows[list + 1]).toContain("Track");
    expect(rows[list + 1]).toContain("T");
    void unmount;
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
