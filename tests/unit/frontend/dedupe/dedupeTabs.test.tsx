// @vitest-environment jsdom
// =============================================================================
// The Duplicates tool's two tabs, and the Manual merge picker's long list
// =============================================================================
// With 5,824 contacts, Manual merge drew every contact and took 44 s to show,
// and going back to Scan kept the merge list on screen while the Scan tab
// waited for it to slide out (`AnimatePresence` in "wait" mode). The tabs
// now swap at once, and the picker draws only the rows near the screen.
// jsdom has no layout, so the virtualizer asks for the first ten rows.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Contact } from "../../../../src/types";

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: { count: number; enabled?: boolean }) => {
      const count = options.enabled ? options.count : 0;
      return {
        getTotalSize: () => count * 68,
        getVirtualItems: () =>
          Array.from({ length: Math.min(count, 10) }, (_, index) => ({
            index,
            key: index,
            start: index * 68,
            size: 68,
            end: (index + 1) * 68,
          })),
        measureElement: () => undefined,
      };
    },
  };
});

const state = vi.hoisted(() => ({ contacts: [] as unknown[] }));
const stub = vi.hoisted(() => () => ({
  mutate: () => undefined,
  mutateAsync: async () => undefined,
  isPending: false,
}));
vi.mock("../../../../src/api", () => ({
  useContacts: () => ({ data: state.contacts, isLoading: false }),
  useMergeCluster: stub,
  useMergeClusters: stub,
  useMergeContacts: stub,
  useMergeLog: () => ({ data: [], isLoading: false }),
  useUndoMerge: stub,
  usePendingSuggestions: () => ({ data: [], isLoading: false }),
  useMergeSuggestion: stub,
  useDismissSuggestion: stub,
}));

const startScan = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/contexts/DedupeContext", () => ({
  useDedupe: () => ({
    scan: null,
    clusters: [],
    isScanning: false,
    isStarting: false,
    startScan,
    reset: vi.fn(),
    removeCluster: vi.fn(),
    isQueued: false,
    showActivity: false,
    setShowActivity: vi.fn(),
  }),
}));

/** The two AI switches: the account's `aiAssist` and the instance's. */
const ai = vi.hoisted(() => ({ account: true, instanceOff: false }));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: {
      motion: "full",
      singleKeyShortcuts: true,
      aiAssist: ai.account,
    },
  }),
}));
vi.mock("../../../../src/api/aiSettings", () => ({
  useInstanceAi: () => ({
    data: { aiOff: ai.instanceOff, lockedByEnv: false },
  }),
}));

import { DedupeView } from "../../../../src/views/dedupe/DedupeView";

const people = (count: number): Contact[] =>
  Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `p${i}`,
        name: `Person ${i}`,
        company: i % 2 ? "Acme" : null,
        role: null,
        avatarUrl: null,
        isGhost: false,
        isArchived: false,
        emails: [],
        phones: [],
      }) as unknown as Contact,
  );

/** The page's one scroller, so the picker finds where it scrolls. */
function mount() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  document.body.appendChild(scroller);
  return render(<DedupeView />, { container: scroller });
}

const search = () =>
  screen.queryByRole("textbox", { name: "Search contacts to merge" });
const quickScan = () => screen.queryByRole("radio", { name: /^Quick scan/ });

beforeEach(() => {
  state.contacts = people(3);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  ai.account = true;
  ai.instanceOff = false;
  startScan.mockClear();
});

describe("the Duplicates tabs", () => {
  it("swaps Scan and Manual merge at once, with nothing of the other tab left", () => {
    mount();
    expect(quickScan()).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Manual merge" }));
    // In the same frame: the merge tab is here and the scans are gone.
    expect(search()).toBeTruthy();
    expect(quickScan()).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Scan" }));
    expect(quickScan()).toBeTruthy();
    expect(search()).toBeNull();
  });

  it("keeps the scan chosen before a trip to Manual merge", () => {
    mount();
    fireEvent.click(quickScan()!);
    expect(quickScan()!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Manual merge" }));
    fireEvent.click(screen.getByRole("radio", { name: "Scan" }));
    expect(quickScan()!.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /^Smart scan/ })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("the scans with AI off", () => {
  const smartScan = () => screen.queryByRole("radio", { name: /^Smart scan/ });

  it("offers the three scans while AI is on, and starts the one chosen", () => {
    mount();
    const picker = screen.getByRole("radiogroup", { name: "Scan" });
    expect(within(picker).getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(startScan).toHaveBeenCalledWith("deep");
  });

  for (const off of ["account", "instance"] as const) {
    it(`offers only the Quick scan, and starts it, while AI is off for the ${off}`, () => {
      if (off === "account") ai.account = false;
      else ai.instanceOff = true;
      mount();
      expect(smartScan()).toBeNull();
      expect(quickScan()!.getAttribute("aria-checked")).toBe("true");
      expect(
        screen.getByText("Smart scan and Full scan use AI, which is off"),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
      expect(startScan).toHaveBeenCalledWith("quick");
    });
  }
});

describe("the Manual merge picker", () => {
  it("draws only the rows near the screen of a long list, and counts them all", () => {
    state.contacts = people(450);
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Manual merge" }));
    expect(screen.getByText("450 contacts")).toBeTruthy();
    const rows = screen.getAllByRole("button", { name: /^Person \d+/ });
    expect(rows).toHaveLength(10);
    // Each avatar waits until it is near the screen.
    expect(
      screen.getAllByRole("img").every((img) => img.getAttribute("loading")),
    ).toBe(true);
  });

  it("searches the whole list, and picks from the rows it finds", () => {
    state.contacts = people(450);
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Manual merge" }));
    fireEvent.change(search()!, { target: { value: "person 44" } });
    // 44 and 440 to 449: a short list, drawn whole.
    expect(screen.getByText("11 contacts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Person 441/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Person 449/ }));
    expect(
      screen.getByRole("button", { name: /Compare 2 contacts/ }),
    ).toBeTruthy();
    expect(screen.getByText("2 / 5 selected")).toBeTruthy();
  });
});
