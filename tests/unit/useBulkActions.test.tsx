// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useBulkActions } from "../../src/components/bulk/useBulkActions";
import * as clipboard from "../../src/lib/clipboard";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const mockBulkDeleteMutate = vi.fn();
const mockBulkUpdateMutate = vi.fn();
const mockBulkAddToListMutate = vi.fn();

vi.mock("../../src/api", () => ({
  useBulkDeleteContacts: () => ({
    mutate: mockBulkDeleteMutate,
    isPending: false,
  }),
  useBulkRestoreContacts: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useBulkUpdateContacts: () => ({
    mutate: mockBulkUpdateMutate,
    isPending: false,
  }),
  useBulkAddToList: () => ({
    mutate: mockBulkAddToListMutate,
    isPending: false,
  }),
}));

describe("useBulkActions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("manages modal open and close states", () => {
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1", "c2"]),
        }),
      { wrapper },
    );

    expect(result.current.isAddToListOpen).toBe(false);
    expect(result.current.isBulkEditOpen).toBe(false);

    act(() => {
      result.current.openAddToList();
    });
    expect(result.current.isAddToListOpen).toBe(true);

    act(() => {
      result.current.closeAddToList();
    });
    expect(result.current.isAddToListOpen).toBe(false);

    act(() => {
      result.current.openBulkEdit();
    });
    expect(result.current.isBulkEditOpen).toBe(true);

    act(() => {
      result.current.closeBulkEdit();
    });
    expect(result.current.isBulkEditOpen).toBe(false);
  });

  it("calls bulk delete mutation with selected ids", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1", "c2"]),
          onComplete,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleBulkDelete();
    });

    expect(mockBulkDeleteMutate).toHaveBeenCalledWith(
      ["c1", "c2"],
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("calls bulk archive mutation with isArchived: true", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1"]),
          onComplete,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleBulkArchive();
    });

    expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
      { ids: ["c1"], data: { isArchived: true } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("calls bulk add to list mutation and closes list modal on success", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1", "c2"]),
          onComplete,
        }),
      { wrapper },
    );

    act(() => {
      result.current.openAddToList();
    });
    expect(result.current.isAddToListOpen).toBe(true);

    act(() => {
      result.current.handleBulkAddToList("list-123");
    });

    expect(mockBulkAddToListMutate).toHaveBeenCalledWith(
      { listId: "list-123", contactIds: ["c1", "c2"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Simulate success callback
    const successCallback = mockBulkAddToListMutate.mock.calls[0][1].onSuccess;
    act(() => {
      successCallback({ count: 2 });
    });

    expect(result.current.isAddToListOpen).toBe(false);
    expect(onComplete).toHaveBeenCalled();
  });

  it("calls bulk color change mutation", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1"]),
          onComplete,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleBulkColorChange("coral");
    });

    expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
      { ids: ["c1"], data: { themeColor: "coral" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("calls bulk edit apply mutation", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1", "c2"]),
          onComplete,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleBulkEditApply("role", "VP Engineering");
    });

    expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
      { ids: ["c1", "c2"], data: { role: "VP Engineering" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  describe("tracking", () => {
    const people = [
      { id: "c1", name: "Ada Lovelace", isTracked: true },
      { id: "c2", name: "Grace Hopper", isTracked: false },
      { id: "c3", name: "Linus Torvalds", isTracked: false },
    ];

    /** The Undo action of the last success toast. */
    const lastUndo = () =>
      (
        toastMock.success.mock.calls.at(-1)?.[1] as {
          action: { onClick: () => void };
        }
      ).action.onClick;

    it("says whether the selection is tracked: all, none or mixed", () => {
      const tracked = (ids: string[]) =>
        renderHook(
          () => useBulkActions({ selectedIds: new Set(ids), contacts: people }),
          { wrapper },
        ).result.current.selectionTracked;
      expect(tracked(["c1"])).toBe("all");
      expect(tracked(["c2", "c3"])).toBe("none");
      expect(tracked(["c1", "c2"])).toBe("mixed");
    });

    it("reads the rows on screen while nothing is selected", () => {
      const { result } = renderHook(
        () =>
          useBulkActions({
            selectedIds: new Set(),
            contacts: people.filter((p) => p.isTracked),
          }),
        { wrapper },
      );
      expect(result.current.selectionTracked).toBe("all");
    });

    it("tracks only the untracked ids, and Undo untracks the same ones", () => {
      const onComplete = vi.fn();
      const { result } = renderHook(
        () =>
          useBulkActions({
            selectedIds: new Set(["c1", "c2", "c3"]),
            contacts: people,
            onComplete,
          }),
        { wrapper },
      );

      act(() => {
        result.current.handleBulkTrack(true);
      });
      expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
        { ids: ["c2", "c3"], data: { isTracked: true } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );

      act(() => {
        mockBulkUpdateMutate.mock.calls[0][1].onSuccess({ count: 2 });
      });
      expect(toastMock.success).toHaveBeenCalledWith(
        "Tracking 2 contacts",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Undo" }),
        }),
      );
      expect(onComplete).toHaveBeenCalledTimes(1);

      act(() => {
        lastUndo()();
      });
      expect(mockBulkUpdateMutate).toHaveBeenLastCalledWith(
        { ids: ["c2", "c3"], data: { isTracked: false } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it("untracks only the tracked ids, and an undone untrack says the cadence is the default", () => {
      const { result } = renderHook(
        () =>
          useBulkActions({
            selectedIds: new Set(["c1", "c2"]),
            contacts: people,
          }),
        { wrapper },
      );

      act(() => {
        result.current.handleBulkTrack(false);
      });
      expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
        { ids: ["c1"], data: { isTracked: false } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );

      act(() => {
        mockBulkUpdateMutate.mock.calls[0][1].onSuccess({ count: 1 });
      });
      expect(toastMock.success.mock.calls[0][0]).toBe(
        "Stopped tracking 1 contact",
      );

      act(() => {
        lastUndo()();
      });
      expect(mockBulkUpdateMutate).toHaveBeenLastCalledWith(
        { ids: ["c1"], data: { isTracked: true } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
      act(() => {
        mockBulkUpdateMutate.mock.calls.at(-1)![1].onSuccess({ count: 1 });
      });
      expect(toastMock.success).toHaveBeenLastCalledWith(
        "Tracking 1 contact again, at the default cadence",
      );
    });

    it("sends nothing when no selected id would change", () => {
      const { result } = renderHook(
        () =>
          useBulkActions({ selectedIds: new Set(["c1"]), contacts: people }),
        { wrapper },
      );
      act(() => {
        result.current.handleBulkTrack(true);
      });
      expect(mockBulkUpdateMutate).not.toHaveBeenCalled();
    });

    it("sets one cadence for the selection and says it in words", () => {
      const onComplete = vi.fn();
      const { result } = renderHook(
        () =>
          useBulkActions({
            selectedIds: new Set(["c1", "c2", "c3"]),
            contacts: people,
            onComplete,
          }),
        { wrapper },
      );
      act(() => {
        result.current.handleBulkCadence(30);
      });
      expect(mockBulkUpdateMutate).toHaveBeenCalledWith(
        { ids: ["c1", "c2", "c3"], data: { cadenceDays: 30 } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
      act(() => {
        mockBulkUpdateMutate.mock.calls[0][1].onSuccess({ count: 3 });
      });
      expect(toastMock.success).toHaveBeenCalledWith("3 contacts, monthly");
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("exports selected contacts as CSV to clipboard", async () => {
    const copySpy = vi.spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const onComplete = vi.fn();
    const contacts = [
      {
        id: "c1",
        name: "Ada Lovelace",
        role: "Mathematician",
        company: "Babbage & Co",
        location: "London, UK",
        emails: [{ email: "ada@example.com" }],
        phones: [{ phone: "+44 123" }],
      },
      {
        id: "c2",
        name: "Grace Hopper",
        role: "Admiral",
        company: "US Navy",
        location: "Arlington, VA",
        emails: [{ email: "grace@example.com" }],
        phones: [{ phone: "+1 456" }],
      },
    ];

    const { result } = renderHook(
      () =>
        useBulkActions({
          selectedIds: new Set(["c1"]),
          contacts,
          onComplete,
        }),
      { wrapper },
    );

    await act(async () => {
      result.current.handleExportCSV();
    });

    expect(copySpy).toHaveBeenCalledTimes(1);
    const csvContent = copySpy.mock.calls[0][0];
    expect(csvContent).toContain("Name,Role,Company,Location,Email,Phone");
    expect(csvContent).toContain(
      '"Ada Lovelace","Mathematician","Babbage & Co","London, UK","ada@example.com","+44 123"',
    );
    expect(csvContent).not.toContain("Grace Hopper");
    expect(onComplete).toHaveBeenCalled();
  });
});
