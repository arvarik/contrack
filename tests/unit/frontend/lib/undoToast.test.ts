import { afterEach, describe, expect, it, vi } from "vitest";

const success = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success } }));

import { toastUndoableDelete } from "../../../../src/lib/undoToast";

describe("toastUndoableDelete", () => {
  afterEach(() => success.mockClear());

  const describeWith = (retentionDays: number): unknown => {
    toastUndoableDelete({ count: 1, retentionDays, onUndo: vi.fn() });
    return success.mock.lastCall?.[1].description;
  };

  it("says how many days the trash keeps the contact", () => {
    expect(describeWith(30)).toBe("Restorable for 30 days");
    expect(describeWith(90)).toBe("Restorable for 90 days");
  });

  it("says day, not days, for a single day", () => {
    expect(describeWith(1)).toBe("Restorable for 1 day");
  });

  it("names the contact or counts the contacts in the title", () => {
    toastUndoableDelete({
      count: 1,
      name: "Alex Chen",
      retentionDays: 7,
      onUndo: vi.fn(),
    });
    toastUndoableDelete({ count: 12, retentionDays: 7, onUndo: vi.fn() });
    expect(success.mock.calls[0][0]).toBe("Alex Chen moved to Trash");
    expect(success.mock.calls[1][0]).toBe("12 contacts moved to Trash");
  });
});
