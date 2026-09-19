// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useBulkActions } from "../../src/components/bulk/useBulkActions";
import * as clipboard from "../../src/lib/clipboard";

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
