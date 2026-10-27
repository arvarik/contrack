// @vitest-environment jsdom
/**
 * The "Your data" settings section: Archived contacts (search, a selection
 * pruned to the rows shown, Undo on restore) and the Trash (search, cached
 * rows kept on a failed refetch).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const apiMock = vi.hoisted(() => ({
  archivedContacts: [] as unknown[],
  archiveMutate: vi.fn(),
  unarchiveMutate: vi.fn(),
  bulkUpdateMutate: vi.fn(),
  bulkDeleteMutate: vi.fn(),
  bulkRestoreMutate: vi.fn(),
  trashData: { items: [] as unknown[], retentionDays: 30 },
  trashError: false,
  restoreMutate: vi.fn(),
  purgeMutate: vi.fn(),
  emptyMutate: vi.fn(),
}));

vi.mock("../../../../src/api", () => ({
  useArchiveContact: () => ({
    mutate: apiMock.archiveMutate,
    isPending: false,
  }),
  useArchivedContacts: () => ({
    data: apiMock.archivedContacts,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUnarchiveContact: () => ({
    mutate: apiMock.unarchiveMutate,
    isPending: false,
  }),
  useBulkUpdateContacts: () => ({
    mutate: apiMock.bulkUpdateMutate,
    isPending: false,
  }),
  useBulkDeleteContacts: () => ({
    mutate: apiMock.bulkDeleteMutate,
    isPending: false,
  }),
  useBulkRestoreContacts: () => ({
    mutate: apiMock.bulkRestoreMutate,
    isPending: false,
  }),
  useTrash: () => ({
    data: apiMock.trashData,
    isLoading: false,
    isError: apiMock.trashError,
    refetch: vi.fn(),
  }),
  useRestoreContact: () => ({
    mutate: apiMock.restoreMutate,
    isPending: false,
  }),
  usePurgeTrashedContact: () => ({
    mutate: apiMock.purgeMutate,
    isPending: false,
  }),
  useEmptyTrash: () => ({
    mutate: apiMock.emptyMutate,
    isPending: false,
  }),
}));

vi.mock("../../../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));

import { ArchivedContactsView } from "../../../../src/views/ArchivedContactsView";
import { TrashView } from "../../../../src/views/TrashView";

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.trashError = false;
});

afterEach(() => {
  cleanup();
});

describe("ArchivedContactsView hardening", () => {
  it("filters archived contacts, prunes hidden selections, and offers Undo on restore", () => {
    apiMock.archivedContacts = [
      {
        id: "c1",
        name: "Ada Lovelace",
        company: "Analytical Engine",
        role: "Mathematician",
        isArchived: true,
        isTracked: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "c2",
        name: "Grace Hopper",
        company: "US Navy",
        role: "Rear Admiral",
        isArchived: true,
        isTracked: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    apiMock.unarchiveMutate.mockImplementation(
      (_id: string, opts: { onSuccess: () => void }) => opts.onSuccess(),
    );

    render(
      <MemoryRouter>
        <ArchivedContactsView />
      </MemoryRouter>,
    );

    // Enter select mode and select all (2 contacts)
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2")).toBeTruthy();

    // Filter down to Ada only; Grace is pruned from selection
    const filter = screen.getByRole("searchbox", {
      name: "Filter archived contacts",
    });
    fireEvent.change(filter, { target: { value: "Ada" } });
    expect(screen.getByText("1")).toBeTruthy();

    // Exit select mode and restore Ada with Undo
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Ada Lovelace" }),
    );
    expect(toastMock.success).toHaveBeenCalledWith(
      "Ada Lovelace restored to Network",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });
});

describe("TrashView hardening", () => {
  it("filters trashed contacts, preserves cached rows on refetch error, and renders LoadFailed when empty on error", async () => {
    apiMock.trashData = {
      items: [
        {
          id: "t1",
          name: "Alan Turing",
          company: "Bletchley Park",
          avatarUrl: null,
          deletedAt: new Date().toISOString(),
        },
        {
          id: "t2",
          name: "Joan Clarke",
          company: "Hut 8",
          avatarUrl: null,
          deletedAt: new Date().toISOString(),
        },
      ],
      retentionDays: 30,
    };

    const { rerender } = render(<TrashView />);
    const filter = screen.getByRole("searchbox", { name: "Filter Trash" });
    fireEvent.change(filter, { target: { value: "Joan" } });
    expect(screen.getByText("Joan Clarke")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Alan Turing")).toBeNull();
    });

    fireEvent.change(filter, { target: { value: "Nonexistent" } });
    expect(
      screen.getByText("No contact in the Trash matches “Nonexistent”"),
    ).toBeTruthy();

    // A failed background refetch keeps cached items visible
    fireEvent.change(filter, { target: { value: "" } });
    apiMock.trashError = true;
    rerender(<TrashView />);
    expect(screen.getByText("Joan Clarke")).toBeTruthy();
    expect(screen.queryByText(/Could not load the Trash/)).toBeNull();

    // An initial load error with no cached items renders LoadFailed
    apiMock.trashData = { items: [], retentionDays: 30 };
    rerender(<TrashView />);
    expect(screen.getByText(/Could not load the Trash/)).toBeTruthy();
  });
});
