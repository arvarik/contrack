// @vitest-environment jsdom
// The Duplicates tool's two tabs, and the Manual merge picker's long list. The
// tabs swap at once, and the picker draws only the rows near the screen, so
// thousands of contacts open fast. jsdom has no layout, so the virtualizer
// asks for the first ten rows. The Check tab is one button.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  useDedupeCount: () => ({ data: { count: 0 } }),
  undoMerges: vi.fn(),
}));

const startScan = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/contexts/DedupeContext", () => ({
  useDedupe: () => ({
    scan: null,
    isScanning: false,
    isStarting: false,
    startScan,
    reset: vi.fn(),
    isQueued: false,
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
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DedupeView />
    </QueryClientProvider>,
    { container: scroller },
  );
}

const search = () =>
  screen.queryByRole("textbox", { name: "Search contacts to merge" });
const checkNow = () => screen.queryByRole("button", { name: /Check now/ });

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
  it("swaps Check and Manual merge at once, with nothing of the other tab left", () => {
    mount();
    expect(checkNow()).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Manual merge" }));
    // In the same frame: the merge tab is here and the check is gone.
    expect(search()).toBeTruthy();
    expect(checkNow()).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Check" }));
    expect(checkNow()).toBeTruthy();
    expect(search()).toBeNull();
  });
});

describe("the one check", () => {
  it("asks AI about the unclear pairs while AI is on", () => {
    mount();
    expect(screen.queryAllByRole("radiogroup")).toHaveLength(1);
    fireEvent.click(checkNow()!);
    expect(startScan).toHaveBeenCalledWith("deep");
  });

  for (const [off, why] of [
    ["account", "AI is off for your account"],
    ["instance", "AI is off on this instance"],
  ] as const) {
    it(`says why and finds exact matches only while AI is off for the ${off}`, () => {
      if (off === "account") ai.account = false;
      else ai.instanceOff = true;
      mount();
      expect(screen.getByText(new RegExp(why))).toBeTruthy();
      fireEvent.click(checkNow()!);
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
    const avatars = Array.from(document.querySelectorAll("img"));
    expect(avatars.every((img) => img.getAttribute("loading"))).toBe(true);
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
