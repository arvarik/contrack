// @vitest-environment jsdom
// `→` on a result opens the actions for one contact: its letter keys, Track
// (none for a ghost, which cannot be tracked) and the quick note's draft.
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
  api.fetch.mockImplementation(async (_url: string, init?: RequestInit) => ({
    json: async () => ({
      ...ADA,
      ...(init?.body ? JSON.parse(init.body as string) : {}),
    }),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const press = (key: string, target: EventTarget = window, init = {}) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });

describe("the actions for one contact", () => {
  it("tracks on T and closes the palette, and a ghost has no Track", async () => {
    const { onClose } = mount();
    press("t");
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lastBody()).toEqual({ isTracked: true }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "Tracking Ada Lovelace, quarterly",
        expect.anything(),
      ),
    );
    cleanup();
    vi.clearAllMocks();

    const ghost = mount({ ...ADA, isGhost: true });
    expect(screen.queryByRole("option", { name: /Track/ })).toBeNull();
    press("t");
    expect(ghost.onClose).not.toHaveBeenCalled();
  });

  // → opens the menu while the palette's search box keeps the focus, so the
  // menu takes the box's letters. B used to type a "b" and close the menu.
  it("answers a letter from the search box, not with a modifier or elsewhere", () => {
    const { onCatchMeUp } = mount();
    const box = document.createElement("input");
    box.setAttribute("cmdk-input", "");
    const other = document.createElement("textarea");
    document.body.append(box, other);
    press("b", box, { metaKey: true }); // ⌘C still copies.
    press("b", other);
    expect(onCatchMeUp).not.toHaveBeenCalled();
    press("b", box);
    expect(onCatchMeUp).toHaveBeenCalledTimes(1);
  });

  it("keeps a note's text when the palette closes, and forgets it once saved", async () => {
    const note = () => screen.getByLabelText("Note") as HTMLTextAreaElement;
    const openNote = () =>
      fireEvent.click(screen.getByRole("option", { name: /Log note/ }));
    mount();
    openNote();
    fireEvent.change(note(), { target: { value: "Met at the café" } });
    cleanup();

    mount();
    openNote();
    expect(note().value).toBe("Met at the café");
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    cleanup();

    mount();
    openNote();
    expect(note().value).toBe("");
  });
});
