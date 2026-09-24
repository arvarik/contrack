// @vitest-environment jsdom
// =============================================================================
// Starting enrichment, and saying why a start was refused
// =============================================================================
// A cooldown, or the enrichment lock another account holds, is not a
// failure. The Enrichment settings page prints the message on the page, so
// the context keeps it in `limitMessage` and shows no toast. "Enrich contact"
// in a contact's actions menu has no page to print it on, because the menu
// closes as the item is chosen, so it asks for a toast as well
// (`limitAs: "toast"`). Without it a refused start said nothing at all.
//
// `startSearch` keeps one identity for the provider's life, so the memoised
// context value does not change on every render of the provider.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

/** The start mutation, as `useStartAISearch` hands it out. */
const start = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("../../src/api/aiSearch", () => ({
  // A new object on every render, as TanStack Query's own is; only `mutate`
  // keeps its identity.
  useStartAISearch: () => ({ ...start }),
  useAISearchStream: () => ({ error: null }),
  useCancelAISearch: () => ({ mutate: vi.fn(), isPending: false }),
}));

import {
  AISearchProvider,
  useAISearch,
} from "../../src/contexts/AISearchContext";
import { ApiError } from "../../src/api/client";

type Context = ReturnType<typeof useAISearch>;

/** Mount the provider and hand back every value its consumer saw. */
function mount() {
  const seen: Context[] = [];
  const Consumer = () => {
    seen.push(useAISearch());
    return null;
  };
  const view = render(
    <AISearchProvider>
      <Consumer />
    </AISearchProvider>,
  );
  return { seen, latest: () => seen[seen.length - 1], view, Consumer };
}

/** The callbacks the last start passed to `mutate`. */
function lastCallbacks() {
  return start.mutate.mock.calls.at(-1)?.[1] as {
    onSuccess: (result: { batchId: string; jobCount: number }) => void;
    onError: (err: unknown) => void;
  };
}

/** A refusal because another account holds the enrichment lock. */
const lockedByOthers = () =>
  new ApiError("Busy", 429, "RATE_LIMITED", undefined, undefined, {
    yours: false,
    queued: false,
  });

const MESSAGE = "Another user's enrichment is running. Try again in a moment";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  start.isPending = false;
});

describe("startSearch", () => {
  it("keeps a limit on the page and out of the toasts by default", () => {
    const { latest } = mount();
    act(() => latest().startSearch(["c1"]));
    expect(start.mutate).toHaveBeenCalledWith(["c1"], expect.any(Object));

    act(() => lastCallbacks().onError(lockedByOthers()));
    expect(latest().limitMessage).toBe(MESSAGE);
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("says a limit in an info toast as well when the caller asks", () => {
    const { latest } = mount();
    act(() => latest().startSearch(["c1"], { limitAs: "toast" }));
    act(() => lastCallbacks().onError(lockedByOthers()));
    expect(toastMock.info).toHaveBeenCalledWith(MESSAGE);
    // Not an error: a wait is not a failure.
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(latest().limitMessage).toBe(MESSAGE);
  });

  it("toasts a failure that is not a limit as an error, however it was asked", () => {
    const { latest } = mount();
    act(() => latest().startSearch(["c1"], { limitAs: "toast" }));
    act(() => lastCallbacks().onError(new Error("AI is not set up")));
    expect(toastMock.error).toHaveBeenCalledWith("AI is not set up");
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(latest().limitMessage).toBeNull();
  });

  it("toasts the start for one contact in the singular", () => {
    const { latest } = mount();
    act(() => latest().startSearch(["c1"], { limitAs: "toast" }));
    act(() => lastCallbacks().onSuccess({ batchId: "b1", jobCount: 1 }));
    expect(toastMock.success).toHaveBeenCalledWith(
      "Enrichment started for 1 contact",
    );
  });

  it("keeps one identity across renders, so the context value stays put", () => {
    const { seen, view, Consumer } = mount();
    const first = seen[0];
    // A render of the provider with nothing changed: the same value.
    view.rerender(
      <AISearchProvider>
        <Consumer />
      </AISearchProvider>,
    );
    const again = seen[seen.length - 1];
    expect(again.startSearch).toBe(first.startSearch);
    expect(again).toBe(first);

    // A start on its way changes `isStarting`, and nothing else.
    start.isPending = true;
    view.rerender(
      <AISearchProvider>
        <Consumer />
      </AISearchProvider>,
    );
    const starting = seen[seen.length - 1];
    expect(starting.isStarting).toBe(true);
    expect(starting.startSearch).toBe(first.startSearch);
  });
});
