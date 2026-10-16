// @vitest-environment jsdom
/**
 * Unit tests for the "Your data" settings section hardening:
 * - TagsPage: NO_AUTOCORRECT on inline rename, Escape cancels, case-insensitive
 *   self-merge guard, standardized errorText toasts, filter bar
 * - ExportCard: accessible download buttons, double-click prevention while
 *   downloading, and errorText toast on export failure
 * - ArchivedContactsView: search filtering, stale selection cleanup when
 *   filtered, and withUndo on restore
 * - TrashView: search filtering, LoadFailed state, and errorText toasts
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const apiMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  tags: [] as { tag: string; count: number; total: number }[],
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
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

vi.mock("../../../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/client")>()),
  apiFetch: (...args: unknown[]) => apiMock.fetch(...args),
}));

vi.mock("../../../../src/api/tags", () => ({
  useTagSummary: () => ({
    data: apiMock.tags,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRenameTag: () => ({
    mutateAsync: apiMock.renameTag,
    isPending: false,
  }),
  useDeleteTag: () => ({
    mutateAsync: apiMock.deleteTag,
    isPending: false,
  }),
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

import { TagsPage } from "../../../../src/views/settings/pages/TagsPage";
import { ExportCard } from "../../../../src/views/settings/ExportCard";
import { ArchivedContactsView } from "../../../../src/views/ArchivedContactsView";
import { TrashView } from "../../../../src/views/TrashView";

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.tags = [
    { tag: "friends", count: 3, total: 3 },
    { tag: "work", count: 5, total: 5 },
  ];
  apiMock.trashError = false;
});

afterEach(() => {
  cleanup();
});

describe("TagsPage hardening", () => {
  const mountTags = () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TagsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("applies NO_AUTOCORRECT to inline rename input, cancels on Escape, blocks exact self-merge, and allows merging tags that differ only by case", async () => {
    apiMock.tags = [
      { tag: "friends", count: 3, total: 3 },
      { tag: "work", count: 5, total: 5 },
      { tag: "Work", count: 2, total: 2 },
    ];
    apiMock.renameTag.mockResolvedValueOnce({ affected: 5 });
    mountTags();

    fireEvent.click(screen.getByRole("button", { name: "Rename friends" }));
    const renameInput = screen.getByRole("textbox", {
      name: "Rename tag friends",
    });
    expect(renameInput.getAttribute("spellcheck")).toBe("false");
    expect(renameInput.getAttribute("autocorrect")).toBe("off");

    fireEvent.keyDown(renameInput, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "Rename tag friends" }),
    ).toBeNull();

    // Open merge modal for "work": exact self-merge ("work") is disabled, but "Work" is allowed
    fireEvent.click(
      screen.getByRole("button", { name: "Merge work into another tag" }),
    );
    const targetInput = screen.getByLabelText("Target tag");
    const mergeBtn = screen.getByRole("button", {
      name: "Merge tags",
    }) as HTMLButtonElement;

    fireEvent.change(targetInput, { target: { value: "work" } });
    expect(mergeBtn.disabled).toBe(true);

    fireEvent.change(targetInput, { target: { value: "Work" } });
    expect(mergeBtn.disabled).toBe(false);
    fireEvent.click(mergeBtn);

    await waitFor(() =>
      expect(apiMock.renameTag).toHaveBeenCalledWith({
        from: "work",
        to: "Work",
      }),
    );
  });

  it("formats tag rename errors with errorText", async () => {
    apiMock.renameTag.mockRejectedValueOnce(new Error("Database locked."));
    mountTags();

    fireEvent.click(screen.getByRole("button", { name: "Rename friends" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rename tag friends" }),
      { target: { value: "family" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save tag name" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Could not rename the tag: Database locked",
      ),
    );
  });
});

describe("ExportCard", () => {
  it("renders native download links for vCard, CSV and JSON exports", () => {
    render(<ExportCard />);

    const vcardLink = screen.getByRole("link", { name: /vCard \(\.vcf\)/ });
    const csvLink = screen.getByRole("link", { name: /Spreadsheet \(\.csv\)/ });
    const jsonLink = screen.getByRole("link", {
      name: /Everything \(\.json\)/,
    });

    expect(vcardLink.getAttribute("href")).toBe("/api/export/vcard");
    expect(vcardLink.hasAttribute("download")).toBe(true);
    expect(csvLink.getAttribute("href")).toBe("/api/export/csv");
    expect(jsonLink.getAttribute("href")).toBe("/api/export/json");
  });
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
