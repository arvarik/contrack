// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast } from "sonner";
import {
  startPendingDelete,
  useHiddenPendingIds,
  resetPendingDeletes,
} from "../../../../src/lib/pendingDeletes";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// timeline.test.tsx owns the delete, its Undo and its send, through
// the real timeline. This file keeps the message that only the Ask history
// passes.
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
});
