// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast } from "sonner";
import {
  startPendingDelete,
  useHiddenPendingIds,
  useHiddenInteractionIds,
  resetPendingDeletes,
} from "../../src/lib/pendingDeletes";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("pendingDeletes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPendingDeletes();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetPendingDeletes();
    vi.useRealTimers();
  });

  it("shows default message 'Interaction deleted' when message is omitted", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenPendingIds());

    expect(result.current.has("item-1")).toBe(false);

    act(() => {
      startPendingDelete({ id: "item-1", send });
    });

    expect(result.current.has("item-1")).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(
      "Interaction deleted",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("shows custom message when message is provided", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenPendingIds());

    act(() => {
      startPendingDelete({
        id: "entry-1",
        send,
        message: "Question deleted",
      });
    });

    expect(result.current.has("entry-1")).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(
      "Question deleted",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("useHiddenInteractionIds is an alias for useHiddenPendingIds", () => {
    expect(useHiddenInteractionIds).toBe(useHiddenPendingIds);
  });

  it("undo restores the item and cancels send", () => {
    let undoAction: (() => void) | undefined;
    vi.mocked(toast.success).mockImplementation((_msg, options) => {
      const opts = options as
        | { action?: { onClick?: () => void }; onAutoClose?: () => void }
        | undefined;
      undoAction = opts?.action?.onClick;
      return "toast-1";
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenPendingIds());

    act(() => {
      startPendingDelete({
        id: "q-123",
        send,
        message: "Question deleted",
      });
    });

    expect(result.current.has("q-123")).toBe(true);
    expect(undoAction).toBeDefined();

    act(() => {
      undoAction!();
    });

    expect(result.current.has("q-123")).toBe(false);

    // Fast-forward past undo window
    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("calls send after the undo window ends", async () => {
    let autoCloseCallback: (() => void) | undefined;
    vi.mocked(toast.success).mockImplementation((_msg, options) => {
      const opts = options as
        | { action?: { onClick?: () => void }; onAutoClose?: () => void }
        | undefined;
      autoCloseCallback = opts?.onAutoClose;
      return "toast-2";
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenPendingIds());

    act(() => {
      startPendingDelete({
        id: "q-456",
        send,
        message: "Question deleted",
      });
    });

    expect(result.current.has("q-456")).toBe(true);
    expect(send).not.toHaveBeenCalled();

    // Trigger autoClose
    await act(async () => {
      autoCloseCallback!();
    });

    expect(send).toHaveBeenCalledTimes(1);
    // It stays hidden after deletion
    expect(result.current.has("q-456")).toBe(true);
  });
});
