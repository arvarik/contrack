// @vitest-environment jsdom
/**
 * Add from text, on the Network list. Closing the dialog (X, Escape or the
 * overlay) only closes, and focus goes back to the control that opened it. A
 * successful extraction opens the New contact form with the fields filled
 * in, and saves what the person keeps of the rest. A result that arrives
 * after a close opens nothing. The V key opens the same dialog.
 *
 * The real ContactList renders here, so the test holds its wiring and not a
 * copy of it. The API is stubbed and nothing is saved.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const parse = vi.fn();
const createContact = vi.fn();
const addInteraction = vi.fn();

vi.mock("../../../../src/api", () => {
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  return {
    useContacts: () => ({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useLists: () => ({ data: [] }),
    useCreateList: mutation,
    useReorderLists: mutation,
    useArchiveContact: mutation,
    useUnarchiveContact: mutation,
    useCreateContact: () => ({ mutateAsync: createContact, isPending: false }),
    useParseContactText: () => ({ mutateAsync: parse, isPending: false }),
    useAddInteraction: () => ({ mutateAsync: addInteraction }),
    useBulkDeleteContacts: mutation,
    useBulkRestoreContacts: mutation,
    useBulkUpdateContacts: mutation,
    useBulkAddToList: mutation,
  };
});
// Dialogs this test never opens, with API hooks of their own.
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { ContactList } from "../../../../src/views/contact-list/ContactList";

afterEach(() => {
  cleanup();
  parse.mockReset();
  createContact.mockReset();
  addInteraction.mockReset();
  vi.mocked(toast.error).mockReset();
});

function mount() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContactList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "New" });
}

const pasteDialog = () =>
  screen.queryByRole("dialog", { name: "Add from text" });
const form = () => screen.queryByRole("dialog", { name: "New contact" });

/** New, then "Add from text", the way a pointer opens it. */
function openFromMenu(newButton: HTMLElement) {
  fireEvent.click(newButton);
  fireEvent.click(screen.getByRole("menuitem", { name: "Add from text" }));
  return screen.getByRole("dialog", { name: "Add from text" });
}

function extract(dialog: HTMLElement, text: string) {
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Paste contact details" }),
    { target: { value: text } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: /Extract/ }));
}

describe("Add from text", () => {
  it("closes with the X and nothing else, and gives focus back to New", async () => {
    const newButton = mount();
    const dialog = openFromMenu(newButton);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(pasteDialog()).toBeNull());
    expect(form()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(newButton));
    expect(parse).not.toHaveBeenCalled();
  });

  it("closes with Escape and nothing else", async () => {
    const newButton = mount();
    openFromMenu(newButton);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(pasteDialog()).toBeNull());
    expect(form()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(newButton));
  });

  it("opens from the V key, and closing it hands focus back to where it was", async () => {
    mount();
    const select = screen.getByRole("button", { name: "Select" });
    select.focus();
    fireEvent.keyDown(select, { key: "v" });
    const dialog = screen.getByRole("dialog", { name: "Add from text" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(pasteDialog()).toBeNull());
    expect(form()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(select));
  });

  it("opens the form filled in when the text was read, and saves what is kept", async () => {
    parse.mockResolvedValue({
      name: "Priya Raman",
      company: "Northwind",
      emails: [
        { email: "priya@northwind.example" },
        { email: "p@home.example" },
      ],
      about: "Builds payment systems.",
      tags: [{ tag: "fintech" }, { tag: "wrong" }],
      interactions: [
        { type: "meeting", date: "2026-10-01", summary: "Talked Series A." },
      ],
    });
    createContact.mockResolvedValue({ id: "c-1" });
    addInteraction.mockResolvedValue({ id: "i-1" });
    const newButton = mount();
    extract(openFromMenu(newButton), "Priya Raman, CTO at Northwind");
    const filled = await screen.findByRole("dialog", { name: "New contact" });
    expect(parse).toHaveBeenCalledWith("Priya Raman, CTO at Northwind");
    expect(pasteDialog()).toBeNull();
    const field = (label: RegExp) =>
      (within(filled).getByLabelText(label) as HTMLInputElement).value;
    expect(field(/Full name/)).toBe("Priya Raman");
    expect(field(/Company/)).toBe("Northwind");
    expect(field(/Email/)).toBe("priya@northwind.example");
    within(filled).getByText("Also saved: about, 1 more email");

    // A wrong tag is unticked, and the meeting's day put right.
    fireEvent.click(within(filled).getByRole("checkbox", { name: "wrong" }));
    fireEvent.change(within(filled).getByLabelText("Date of the meeting"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.click(
      within(filled).getByRole("button", { name: "Save contact" }),
    );
    await waitFor(() => expect(form()).toBeNull());
    expect(createContact.mock.calls[0][0]).toMatchObject({
      name: "Priya Raman",
      about: "Builds payment systems.",
      emails: [
        { email: "priya@northwind.example", isPrimary: true },
        { email: "p@home.example" },
      ],
      tags: [{ tag: "fintech" }],
    });
    expect(addInteraction).toHaveBeenCalledWith({
      contactId: "c-1",
      data: {
        type: "meeting",
        title: "Meeting",
        content: "Talked Series A.",
        date: "2026-09-30",
      },
    });
    // The form gives focus to New, not to the gone Extract button.
    await waitFor(() => expect(document.activeElement).toBe(newButton));
  });

  it("opens nothing when the text is read after the dialog was closed", async () => {
    let finish!: (value: { name: string }) => void;
    parse.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const newButton = mount();
    const dialog = openFromMenu(newButton);
    extract(dialog, "Someone at Somewhere");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(pasteDialog()).toBeNull());
    await act(async () => finish({ name: "Someone" }));
    expect(form()).toBeNull();
  });

  it("stays open and says so when the text cannot be read, and says nothing once closed", async () => {
    parse.mockRejectedValue(new Error("No key"));
    const newButton = mount();
    const dialog = openFromMenu(newButton);
    extract(dialog, "Someone at Somewhere");
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(pasteDialog()).not.toBeNull();
    expect(form()).toBeNull();

    let fail!: (reason: Error) => void;
    parse.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    extract(dialog, "Someone else");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(pasteDialog()).toBeNull());
    await act(async () => fail(new Error("No key")));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(form()).toBeNull();
  });
});
