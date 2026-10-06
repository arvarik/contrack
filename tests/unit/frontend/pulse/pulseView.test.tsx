// @vitest-environment jsdom
// =============================================================================
// Pulse: the rules a browser journey does not pin cheaply
// =============================================================================
// The journeys are in tests/e2e/pulse.spec.ts: the masthead and its jumps,
// the rows and their keys, Tab into the queue, the Inbox and Composition
// links, the heatmap, customize mode with the mouse, the keyboard and a
// phone. Here: the keys that must do nothing (a row nobody sees, an open
// menu), the Undo of done, snooze and reset, the Tab stops of the queue,
// its first rows on one column, and what each card says when it is empty.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PulseView } from "../../../../src/views/pulse/PulseView";
import { PulseSkeleton } from "../../../../src/views/pulse/components/PulseSkeleton";
import { ComingUpCard } from "../../../../src/views/pulse/cards/ComingUpCard";
import { InsightCard } from "../../../../src/views/pulse/cards/InsightCard";
import { KeepingUpCard } from "../../../../src/views/pulse/cards/KeepingUpCard";
import { connectorKeys } from "../../../../src/api/connectors";
import type { DashboardPayload } from "../../../../src/api";
import { resetPendingDeletes } from "../../../../src/lib/pendingDeletes";

/** The toasts, so a test can press Undo or end its window. */
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(() => "toast-1"),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: toastMock }));
/** The last success toast: its words and its options. */
const lastToast = () =>
  (
    toastMock.success.mock.calls as unknown as [
      string,
      { action: { onClick: () => void }; onAutoClose: () => void },
    ][]
  ).at(-1)!;

vi.mock("../../../../src/views/dedupe/components/DuplicateQueue", () => ({
  DuplicateQueue: () => null,
}));

const mockCompleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockSetPreference = vi.fn();
let mockDashboardData: DashboardPayload | null = null;
let mockDashboardError = false;
const mockRefetch = vi.fn();
let mockPreferences = {
  pulseLayout: { hidden: [] as string[], order: {} },
  singleKeyShortcuts: true,
};
let mockAiAllowed = true;
let mockIsAdmin = true;
let mockAiSettings: unknown = undefined;

vi.mock("../../../../src/api", () => ({
  useDashboard: () => ({
    data: mockDashboardData,
    isLoading: false,
    isError: mockDashboardError,
    refetch: mockRefetch,
  }),
  useDailyInsight: () => ({
    data: { text: "Strategic networking update.", category: "Strategy" },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useDashboardActivity: () => ({ data: undefined }),
  useContacts: () => ({ data: [] }),
  useCompletedActionItems: () => ({ data: [] }),
  useCompleteActionItem: () => ({ mutateAsync: mockCompleteMutate }),
  useUpdateActionItem: () => ({ mutate: mockUpdateMutate }),
  useDedupeCount: () => ({ data: { count: 0 } }),
}));

vi.mock("../../../../src/api/aiSettings", () => ({
  useAISettings: () => ({ data: mockAiSettings }),
}));

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    setPreference: mockSetPreference,
  }),
}));

vi.mock("../../../../src/hooks/useSingleKeyShortcuts", () => ({
  useSingleKeyShortcuts: () => mockPreferences.singleKeyShortcuts,
}));

vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => mockAiAllowed,
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin, user: { id: "u1", name: "Admin" } }),
}));

/** A follow-up the server sent, due on `dueAt`. */
const followUp = (id: string, title: string, dueAt: string) => ({
  id,
  contactId: `c-${id}`,
  contactName: `Person ${id}`,
  contactAvatarUrl: null,
  contactThemeColor: "#006a91",
  title,
  dueAt,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

function createSampleDashboard(
  overrides?: Partial<DashboardPayload>,
): DashboardPayload {
  return {
    overdue: [followUp("act-1", "Send whitepaper", "2026-09-10T10:00:00.000Z")],
    dueToday: [
      followUp("act-2", "Prep coffee meeting", "2026-09-17T10:00:00.000Z"),
    ],
    upcoming: [],
    ghosts: [],
    metrics: { totalActive: 42, newContacts30d: 4 },
    catchUp: [],
    tracking: {
      count: 3,
      bands: { strong: 1, fading: 1, atRisk: 1, unscored: 0 },
      catchUpCount: 0,
      startedLast30d: 1,
      snapshotWeeks: 0,
      rising: [],
      cooling: [],
    },
    recentlyAdded: [],
    industryComposition: [],
    locationComposition: [],
    roleComposition: [],
    interactionBreakdown30d: [],
    networkGrowthTimeline30d: [],
    hygiene: {
      missingCompany: 0,
      missingLocation: 0,
      missingEmail: 0,
      stale: 0,
    },
    meetings: [],
    correspondents: 0,
    ...overrides,
  } as DashboardPayload;
}

/** jsdom has no matchMedia. `matches` answers every query. */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

/** A query client that already knows the account's connectors. */
function clientWith(connectors: { kind: string }[] = []) {
  const client = new QueryClient();
  client.setQueryData(connectorKeys.lists(), connectors);
  return client;
}

function renderWithClient(ui: React.ReactElement, client = clientWith()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/pulse"]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const renderPulse = () => renderWithClient(<PulseView />);

/** The rows of the queue, not the other lists on the page. */
const queueRows = () =>
  within(screen.getByRole("group", { name: "Up next items" })).getAllByRole(
    "listitem",
  );

describe("Pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubMatchMedia(true);
    mockDashboardData = createSampleDashboard();
    mockDashboardError = false;
    mockPreferences = {
      pulseLayout: { hidden: [], order: {} },
      singleKeyShortcuts: true,
    };
    mockAiAllowed = true;
    mockIsAdmin = true;
    mockAiSettings = undefined;
  });

  afterEach(() => {
    cleanup();
    resetPendingDeletes();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a loaded Pulse when a refetch fails, and offers Try again when nothing loaded", () => {
    mockDashboardError = true;
    const { unmount } = renderPulse();
    expect(screen.queryByText("Could not load Pulse")).toBeNull();
    expect(queueRows().length).toBeGreaterThan(0);
    unmount();

    mockDashboardData = null;
    renderPulse();
    expect(screen.getByText("Could not load Pulse")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it("never completes a row nobody can see: the first D only shows it, and Undo keeps it unsent", () => {
    renderPulse();
    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getByText("Send whitepaper")).toBeDefined();
    expect(toastMock.success).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "d" });
    expect(screen.queryByText("Send whitepaper")).toBeNull();
    act(() => lastToast()[1].action.onClick());
    expect(screen.getByText("Send whitepaper")).toBeDefined();
    act(() => lastToast()[1].onAutoClose());
    expect(mockCompleteMutate).not.toHaveBeenCalled();
  });

  it("leaves the queue keys to an open menu", () => {
    renderPulse();
    fireEvent.click(
      within(queueRows()[0]).getByRole("button", { name: "Snooze item" }),
    );
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "s" });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Send whitepaper")).toBeDefined();
  });

  it("snoozes with S, says to which day, and Undo puts the old date back", () => {
    renderPulse();
    fireEvent.keyDown(window, { key: "s" });
    fireEvent.keyDown(window, { key: "s" });
    const [variables, callbacks] = mockUpdateMutate.mock.calls[0];
    expect(variables.id).toBe("act-1");
    expect(Date.parse(variables.data.dueAt)).toBeGreaterThan(Date.now());

    act(() => callbacks.onSuccess());
    const [message, options] = lastToast();
    expect(message).toMatch(/^Follow-up snoozed to \w+/);
    act(() => options.action.onClick());
    expect(mockUpdateMutate).toHaveBeenLastCalledWith({
      id: "act-1",
      data: { dueAt: "2026-09-10T10:00:00.000Z" },
    });
  });

  it("is one Tab stop: only the current row and its controls take Tab", () => {
    renderPulse();
    const [first, second] = queueRows();
    const controls = (row: HTMLElement) => [
      row,
      ...within(row).getAllByRole("button"),
      ...within(row).getAllByRole("link"),
    ];
    expect(controls(first).map((el) => el.tabIndex)).toEqual([0, 0, 0, 0]);
    expect(controls(second).map((el) => el.tabIndex)).toEqual([-1, -1, -1, -1]);
  });

  it("shows the first eight rows on one column, and J past them shows the rest", () => {
    stubMatchMedia(false);
    mockDashboardData = createSampleDashboard({
      overdue: Array.from({ length: 10 }, (_, i) =>
        followUp(`act-${i}`, `Task ${i}`, `2026-09-0${(i % 9) + 1}T10:00:00Z`),
      ),
      dueToday: [],
    });
    renderPulse();
    expect(queueRows()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Show all 10" })).toBeDefined();

    for (let i = 0; i < 9; i++) fireEvent.keyDown(window, { key: "j" });
    expect(queueRows()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("resets the layout with Undo, and Done hands focus to the More menu", () => {
    const saved = { hidden: ["keeping-up"], order: {} };
    mockPreferences.pulseLayout = saved;
    renderPulse();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Customize layout" }));

    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(mockSetPreference).toHaveBeenLastCalledWith(
      "pulseLayout",
      expect.objectContaining({ hidden: [] }),
    );
    act(() => lastToast()[1].action.onClick());
    expect(mockSetPreference).toHaveBeenLastCalledWith("pulseLayout", saved);

    const done = screen.getByRole("button", { name: "Done" });
    done.focus();
    fireEvent.click(done);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More" }),
    );
  });

  it("draws the skeleton's Daily insight as a card at its words' height, and as a line only when there is none", () => {
    const line = "Set up a Fast model to get one. Open AI settings";
    const { rerender } = render(<PulseSkeleton />);
    expect(screen.getByText("Relationship maintenance")).toBeDefined();
    expect(screen.queryByText(line)).toBeNull();

    rerender(<PulseSkeleton insight="Three people went quiet." />);
    const words = screen.getByText("Three people went quiet.");
    expect(words.getAttribute("aria-hidden")).toBe("true");
    expect(words.className).toContain("text-transparent");

    rerender(<PulseSkeleton insight={null} />);
    expect(screen.getByText(line).getAttribute("aria-hidden")).toBe("true");
  });

  describe("InsightCard", () => {
    const ready = {
      instance: { aiOff: false },
      capabilities: { quick: { resolved: true } },
      providers: [{}],
      customEndpoints: [],
    };
    const noModel = { ...ready, capabilities: {}, providers: [] };

    it.each([
      [
        "a failed provider",
        ready,
        true,
        "Could not write today's insight.",
        "Try again",
      ],
      [
        "no model, to an admin",
        noModel,
        true,
        "Set up a Fast model to get one.",
        "Open AI settings",
      ],
      [
        "no model, to a member",
        noModel,
        false,
        "Your admin has not set up AI yet",
        null,
      ],
    ])("says why there is none for %s", (_, settings, admin, words, door) => {
      mockAiSettings = settings;
      mockIsAdmin = admin;
      const onRetry = vi.fn();
      renderWithClient(
        <InsightCard isLoading={false} insight={null} onRetry={onRetry} />,
      );
      expect(
        screen.getByText(new RegExp(words.replace(".", "\\."))),
      ).toBeDefined();
      if (door === "Try again") {
        fireEvent.click(screen.getByRole("button", { name: door }));
        expect(onRetry).toHaveBeenCalledOnce();
      } else if (door) {
        expect(
          screen.getByRole("link", { name: door }).getAttribute("href"),
        ).toBe("/settings/admin/ai");
      } else {
        expect(screen.queryByRole("link")).toBeNull();
      }
    });

    it("points an account with AI off at its switch", () => {
      renderWithClient(
        <InsightCard isLoading={false} insight={null} aiAllowed={false} />,
      );
      expect(
        screen
          .getByRole("link", {
            name: "Turn it on in Settings → Privacy and AI",
          })
          .getAttribute("href"),
      ).toBe("/settings/privacy#ai-assist");
    });
  });

  describe("ComingUpCard", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 8, 21, 9));
    });

    it("lists the meetings by date, and an all-day event on its own day with no clock time", () => {
      renderWithClient(
        <ComingUpCard
          meetings={[
            { title: "Offsite", startsAt: "2026-09-25", contactIds: [] },
            {
              title: "Sprint planning",
              startsAt: new Date(2026, 8, 23, 15).toISOString(),
              contactIds: [],
            },
          ]}
        />,
      );
      const rows = screen
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
      expect(rows[0]).toContain("Sprint planning");
      expect(rows[0]).toContain("Wednesday");
      // A plain day is that day here, never the evening before.
      expect(rows[1]).toContain("Offsite");
      expect(rows[1]).toContain("Friday");
      expect(rows[1]).toContain("all day");
      expect(rows[1]).not.toMatch(/\d:\d\d/);
    });

    it("offers a calendar only to an account with none connected", () => {
      const { unmount } = renderWithClient(<ComingUpCard />);
      expect(
        screen
          .getByRole("link", { name: "Connect a calendar" })
          .getAttribute("href"),
      ).toBe("/settings/connectors");
      unmount();

      renderWithClient(<ComingUpCard />, clientWith([{ kind: "ics" }]));
      expect(screen.getByText("Nothing coming up")).toBeDefined();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("hides Keeping up's Rising and Cooling before four snapshot weeks, and the catch-up button at zero", () => {
    renderWithClient(
      <KeepingUpCard
        tracking={{
          count: 42,
          bands: { strong: 30, fading: 8, atRisk: 4, unscored: 0 },
          catchUpCount: 0,
          startedLast30d: 5,
          snapshotWeeks: 3,
          rising: [],
          cooling: [],
        }}
      />,
    );
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.queryByRole("button", { name: /to catch up/ })).toBeNull();
    expect(screen.getByText("of 42 within cadence")).toBeDefined();
  });
});
