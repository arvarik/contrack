// @vitest-environment jsdom
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
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { PulseView } from "../../src/views/pulse/PulseView";
import { PulseSkeleton } from "../../src/views/pulse/components/PulseSkeleton";
import { DuplicatesPage } from "../../src/views/pulse/pages/DuplicatesPage";
import { ActionRow } from "../../src/views/pulse/cards/ActionRow";
import { ComingUpCard } from "../../src/views/pulse/cards/ComingUpCard";
import { Masthead } from "../../src/views/pulse/components/Masthead";
import { CardFrame } from "../../src/views/pulse/components/CardFrame";
import { CardCustomizeContext } from "../../src/views/pulse/context/CardCustomizeContext";
import { CompletedCard } from "../../src/views/pulse/cards/CompletedCard";
import { InboxCard } from "../../src/views/pulse/cards/InboxCard";
import { InsightCard } from "../../src/views/pulse/cards/InsightCard";
import { ActivityCard } from "../../src/views/pulse/cards/ActivityCard";
import { KeepingUpCard } from "../../src/views/pulse/cards/KeepingUpCard";
import { CompositionCard } from "../../src/views/pulse/cards/CompositionCard";
import { AskForm } from "../../src/views/pulse/components/AskForm";
import type { DashboardPayload } from "../../src/api";
import { PAGE_TITLE, PAGE_TITLE_SUFFIX } from "../../src/lib/styles";
import { CHECK_RING_REST } from "../../src/views/pulse/lib/pulseStyles";

vi.mock("../../src/views/dedupe/components", () => ({
  SuggestionReviewQueue: () => (
    <div data-testid="suggestion-review-queue">Mock Dedupe Queue</div>
  ),
}));

vi.mock("../../src/views/pulse/NetworkCompositionModal", () => ({
  NetworkCompositionModal: () => <div data-testid="composition-modal" />,
}));

const mockCompleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockSetPreference = vi.fn();
let mockDashboardData: DashboardPayload | null = null;
const COMPLETED_ITEM = {
  id: "done-1",
  contactId: "c-1",
  contactName: "Ada Lovelace",
  title: "Sent follow up email",
  completedAt: "2026-09-17T14:00:00.000Z",
};
let mockCompletedItems: (typeof COMPLETED_ITEM)[] = [COMPLETED_ITEM];
let mockPreferences: {
  pulseLayout: { hidden: string[]; order: Record<string, string[]> };
  singleKeyShortcuts: boolean;
} = {
  pulseLayout: { hidden: [], order: {} },
  singleKeyShortcuts: true,
};
let mockAiAllowed = true;
let mockIsAdmin = true;
/** The slim rows. Ada is tracked and old, so the Inbox has no New people row. */
const ADA_ROW = {
  id: "c-1",
  name: "Ada Lovelace",
  avatarUrl: null,
  themeColor: "#006a91",
  birthday: "1990-09-19",
  isTracked: true,
  isGhost: false,
  addedAt: "2026-01-05T10:00:00.000Z",
};
let mockContacts: Array<Record<string, unknown>> = [ADA_ROW];

vi.mock("../../src/api", () => ({
  useDashboard: () => ({
    data: mockDashboardData,
    isLoading: false,
    isError: false,
  }),
  useDailyInsight: () => ({
    data: { text: "Strategic networking update.", category: "Strategy" },
    isLoading: false,
  }),
  useDashboardActivity: () => ({
    data: {
      days: [],
      weekTotals: [],
      prevWeekTotals: [],
      streak: { current: 3, best: 10, lastDay: "2026-09-17" },
      today: { logged: 1, completed: 2, due: 1 },
      thisWeek: { logged: 5, byType: {} },
    },
  }),
  useContacts: () => ({
    data: mockContacts,
  }),
  useCompletedActionItems: () => ({
    data: mockCompletedItems,
  }),
  useCompleteActionItem: () => ({
    mutate: mockCompleteMutate,
    isPending: false,
  }),
  useUpdateActionItem: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
  useDedupeCount: () => ({
    data: { count: 0 },
  }),
  usePendingSuggestions: () => ({
    data: [],
    isLoading: false,
  }),
  useMergeSuggestion: () => ({
    mutate: vi.fn(),
  }),
  useMergeCluster: () => ({
    mutate: vi.fn(),
  }),
  useDismissSuggestion: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    setPreference: mockSetPreference,
  }),
}));

vi.mock("../../src/hooks/useSingleKeyShortcuts", () => ({
  useSingleKeyShortcuts: () => mockPreferences.singleKeyShortcuts,
}));

vi.mock("../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => mockAiAllowed,
}));

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({
    isAdmin: mockIsAdmin,
    user: { id: "u1", name: "Admin" },
  }),
}));

function createSampleDashboard(
  overrides?: Partial<DashboardPayload>,
): DashboardPayload {
  return {
    overdue: [
      {
        id: "act-1",
        contactId: "c-1",
        contactName: "Ada Lovelace",
        contactAvatarUrl: null,
        contactThemeColor: "#006a91",
        title: "Send whitepaper",
        dueAt: "2026-09-10T10:00:00.000Z",
        completedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    dueToday: [
      {
        id: "act-2",
        contactId: "c-2",
        contactName: "Grace Hopper",
        contactAvatarUrl: null,
        contactThemeColor: "#10b981",
        title: "Prep coffee meeting",
        dueAt: "2026-09-17T10:00:00.000Z",
        completedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    upcoming: [],
    ghosts: [],
    metrics: {
      totalActive: 42,
      newContacts30d: 4,
    },
    catchUp: [
      {
        id: "c-3",
        name: "Alan Turing",
        company: "Bletchley",
        avatarUrl: null,
        themeColor: "#8b5cf6",
        relationshipScore: 35,
        lastContactedAt: "2026-08-12T10:00:00.000Z",
        cadenceDays: 30,
        daysSince: 40,
        overshootDays: 10,
      },
    ],
    tracking: {
      count: 3,
      bands: { strong: 1, fading: 1, atRisk: 1, unscored: 0 },
      catchUpCount: 1,
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
  };
}

/**
 * `window.matchMedia` for the masthead, which renders the counts as buttons
 * from `sm` up and as text below it. jsdom has no matchMedia at all.
 */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** Customize lives in the More menu. Open it and choose the item. */
function openCustomize() {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Customize layout" }));
}

/**
 * Pulse with a route that would render if anything navigated to a contact.
 * The Enter guard and the row keys assert on the marker.
 */
function renderPulseWithContactRoute() {
  return render(
    <MemoryRouter initialEntries={["/pulse"]}>
      <Routes>
        <Route path="/pulse/*" element={<PulseView />} />
        <Route
          path="/contact/:id"
          element={<div data-testid="contact-marker" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("frontend.pulse", () => {
  beforeEach(() => {
    mockCompleteMutate.mockClear();
    mockUpdateMutate.mockClear();
    mockSetPreference.mockClear();
    mockDashboardData = createSampleDashboard();
    mockCompletedItems = [COMPLETED_ITEM];
    mockPreferences = {
      pulseLayout: { hidden: [], order: {} },
      singleKeyShortcuts: true,
    };
    mockAiAllowed = true;
    mockIsAdmin = true;
    mockContacts = [ADA_ROW];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the h1 'Pulse'", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Pulse" });
    expect(heading).toBeDefined();
  });

  it("renders eight cards by default", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const cards = container.querySelectorAll("[data-card-id]");
    expect(cards.length).toBe(8);

    const expectedCardIds = [
      "up-next",
      "completed",
      "insight",
      "inbox",
      "coming-up",
      "keeping-up",
      "activity",
      "composition",
    ];
    const renderedCardIds = Array.from(cards).map((el) =>
      el.getAttribute("data-card-id"),
    );
    expect(renderedCardIds.sort()).toEqual(expectedCardIds.sort());
  });

  it("ensures a hidden card from the preference is absent", () => {
    mockPreferences = {
      pulseLayout: { hidden: ["keeping-up"], order: {} },
      singleKeyShortcuts: true,
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const cards = container.querySelectorAll("[data-card-id]");
    expect(cards.length).toBe(7);
    expect(container.querySelector('[data-card-id="keeping-up"]')).toBeNull();
    expect(container.querySelector('[data-card-id="up-next"]')).not.toBeNull();
  });

  it("moves highlight with J and completes the highlighted item with D", async () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Initial item is index 0 ("act-1")
    const listItems = screen.getAllByRole("listitem");
    expect(listItems[0].getAttribute("aria-current")).toBe("true");

    // The first 'j' only shows the current row: a key acts on a row the
    // person can see.
    fireEvent.keyDown(window, { key: "j" });
    expect(listItems[0].getAttribute("aria-current")).toBe("true");
    expect(listItems[0].className).toContain("row-selected");

    // The next 'j' moves the highlight down to index 1 ("act-2")
    fireEvent.keyDown(window, { key: "j" });
    expect(listItems[1].getAttribute("aria-current")).toBe("true");

    // Press 'd' to complete highlighted item ("act-2")
    fireEvent.keyDown(window, { key: "d" });
    expect(mockCompleteMutate).toHaveBeenCalledWith("act-2");
  });

  it("never completes a row nobody can see: the first D only shows it", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    const listItems = screen.getAllByRole("listitem");
    expect(listItems[0].className).not.toContain("row-selected");

    fireEvent.keyDown(window, { key: "d" });
    expect(mockCompleteMutate).not.toHaveBeenCalled();
    expect(listItems[0].className).toContain("row-selected");

    // Now the row shows, and D completes it.
    fireEvent.keyDown(window, { key: "d" });
    expect(mockCompleteMutate).toHaveBeenCalledWith("act-1");
  });

  it("renders Inbox as one line, 'Nothing to clean up.', when there is nothing to do", () => {
    mockDashboardData = createSampleDashboard({
      ghosts: [],
      hygiene: {
        missingCompany: 0,
        missingLocation: 0,
        missingEmail: 0,
        stale: 0,
      },
      correspondents: 0,
    });

    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    expect(screen.getByText("Nothing to clean up.")).toBeDefined();
    // A line: the section has no card surface class.
    const inbox = document.querySelector('[data-card-id="inbox"]');
    expect(inbox?.className).not.toContain("bg-surface-container-lowest");
    expect(screen.queryByText(/new this month/)).toBeNull();
  });

  it("puts the New people row first in Inbox, from the untracked rows added this month", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 21, 9));
    mockContacts = [
      ADA_ROW,
      // Two new and untracked, one new and tracked, one new ghost, one old.
      {
        ...ADA_ROW,
        id: "n-1",
        name: "New One",
        isTracked: false,
        addedAt: "2026-09-15T10:00:00.000Z",
      },
      {
        ...ADA_ROW,
        id: "n-2",
        name: "New Two",
        isTracked: false,
        addedAt: "2026-09-20T10:00:00.000Z",
      },
      {
        ...ADA_ROW,
        id: "n-3",
        name: "New Three",
        isTracked: true,
        addedAt: "2026-09-18T10:00:00.000Z",
      },
      {
        ...ADA_ROW,
        id: "n-4",
        name: "Ghost",
        isTracked: false,
        isGhost: true,
        addedAt: "2026-09-18T10:00:00.000Z",
      },
      {
        ...ADA_ROW,
        id: "n-5",
        name: "Old",
        isTracked: false,
        addedAt: "2026-06-01T10:00:00.000Z",
      },
    ];
    mockDashboardData = createSampleDashboard({
      metrics: { totalActive: 42, newContacts30d: 3 },
      hygiene: {
        missingCompany: 4,
        missingLocation: 0,
        missingEmail: 0,
        stale: 0,
      },
    });

    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const inbox = screen.getByRole("region", { name: /^Inbox/ });
    const rows = inbox.querySelectorAll("li");
    const first = rows[0].querySelector("a");
    expect(first?.textContent).toBe("3 new this month, 2 untracked");
    expect(first?.getAttribute("href")).toBe("/?q=tracked:no");
    expect(
      screen.getByRole("link", { name: "4 without a company" }),
    ).toBeDefined();
    // The count after the title adds the untracked people to the jobs.
    expect(
      screen.getByRole("heading", { level: 2, name: /^Inbox,\s?6$/ }),
    ).toBeDefined();
  });

  it("renders the Ask form under the masthead when AI is allowed, and not when it is off", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    const form = screen.getByRole("search", { name: "Ask about your network" });
    expect(screen.getByLabelText("Today summary").contains(form)).toBe(true);
    unmount();

    mockAiAllowed = false;
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("search", { name: "Ask about your network" }),
    ).toBeNull();
    expect(
      screen.getByText("AI is off for your account.", { exact: false }),
    ).toBeDefined();
  });

  it("puts the Catch up group after the birthdays, with the words and the Log button", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    expect(screen.getByText("Catch up")).toBeDefined();
    expect(screen.getByText("10 days past due")).toBeDefined();
    expect(screen.getByText("Check in with Alan Turing")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Log note for Alan Turing" }),
    ).toBeDefined();
    // Nothing on Pulse says "Slipping" any more.
    expect(screen.queryByText("Slipping")).toBeNull();
  });

  it("gives each group an h3 with its id, for the masthead's jumps", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    const ids = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => [h.textContent?.replace(/\d+$/, "").trim(), h.id]);
    expect(ids).toEqual([
      ["Overdue", "up-next-overdue"],
      ["Today", "up-next-today"],
      ["Catch up", "up-next-catch-up"],
    ]);
  });

  it("says how many catch-ups wait past the ten the server sent", () => {
    mockDashboardData = createSampleDashboard({
      tracking: {
        ...createSampleDashboard().tracking,
        catchUpCount: 14,
      },
    });
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    expect(screen.getByText("1 of 14")).toBeDefined();
  });

  it("shows the Keeping up card on Pulse with the bar and the number, and nothing about four weeks or thirty days", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const card = screen.getByRole("region", { name: /^Keeping up/ });
    expect(
      screen.getByRole("img", {
        name: "3 tracked: 1 strong, 1 fading, 1 at risk, 0 with no interactions yet",
      }),
    ).toBeDefined();
    expect(card.querySelector('[role="img"]')?.className).toContain("h-2.5");
    expect(within(card).getByText("2")).toBeDefined();
    expect(within(card).getByText("of 3 within cadence")).toBeDefined();
    expect(within(card).queryByText(/four weeks/)).toBeNull();
    expect(within(card).queryByText(/in the last 30 days/)).toBeNull();
    expect(
      screen.getByRole("link", { name: "Manage" }).getAttribute("href"),
    ).toBe("/tracked");

    // "1 to catch up" scrolls the queue to the Catch up heading.
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      scrolled.push(this);
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: "1 to catch up" }));
      expect(scrolled.map((el) => el.id)).toContain("up-next-catch-up");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("renders WelcomeOffice when totalActive is zero", () => {
    mockDashboardData = createSampleDashboard({
      metrics: {
        totalActive: 0,
        newContacts30d: 0,
      },
    });

    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    expect(screen.getByText("Bring your people in")).toBeDefined();
    expect(
      screen.getByText(
        "Import contacts and log a note. Pulse fills itself from there.",
      ),
    ).toBeDefined();
    // The welcome masthead is quiet: the title, the date and the actions, no
    // sentence.
    expect(
      screen.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Log note" })).toBeDefined();
    expect(screen.queryByText(/All caught up/)).toBeNull();
    expect(screen.getByText("Import contacts")).toBeDefined();
    expect(screen.getByText("Log your first note")).toBeDefined();
    expect(screen.getByText("Connect AI")).toBeDefined();
  });

  it("renders PulseSkeleton", () => {
    const { container } = render(<PulseSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("draws the skeleton's Daily insight as a card at its words' height, and as a line only when there is none", () => {
    const line = "Add an AI key to get one. Open AI settings";
    // On its way: the card, the likely answer with AI on, its paragraph as
    // bars of an insight of a common length.
    const { rerender } = render(<PulseSkeleton />);
    expect(screen.getByText("Relationship maintenance")).toBeDefined();
    expect(screen.queryByText(line)).toBeNull();

    // Back: the card, with the insight's own words in a transparent ink,
    // so the bars wrap where the paragraph will. A screen reader skips them.
    rerender(<PulseSkeleton insight="Three people went quiet." />);
    const words = screen.getByText("Three people went quiet.");
    expect(words.getAttribute("aria-hidden")).toBe("true");
    expect(words.className).toContain("text-transparent");

    // None to draw: the line, in the loaded line's words.
    rerender(<PulseSkeleton insight={null} />);
    expect(screen.getByText(line).getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Relationship maintenance")).toBeNull();
  });

  it("tells the skeleton what the page knows about the insight before the dashboard loads", () => {
    mockDashboardData = null;
    // The insight has come back, so the skeleton draws its words.
    const { unmount } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Loading Pulse")).toBeDefined();
    expect(
      screen
        .getByText("Strategic networking update.")
        .getAttribute("aria-hidden"),
    ).toBe("true");
    unmount();

    // With AI off the loaded card is a line, so the skeleton's is too.
    mockAiAllowed = false;
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Add an AI key to get one. Open AI settings"),
    ).toBeDefined();
  });

  it("renders DuplicatesPage with back link to Pulse", () => {
    render(
      <MemoryRouter initialEntries={["/pulse/duplicates"]}>
        <DuplicatesPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /Possible duplicates/i }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: /Pulse/i })).toBeDefined();
  });

  describe("ActionRow", () => {
    const followUp = {
      id: "item-1",
      kind: "action_item" as const,
      group: "overdue" as const,
      contactId: "c-1",
      contactName: "Ada Lovelace",
      contactAvatarUrl: null,
      contactThemeColor: "#006a91",
      isTracked: true,
      relationshipScore: 72,
      lastContactedAt: "2026-09-16T10:00:00.000Z",
      title: "Call Ada",
      dueAt: "2026-09-10T10:00:00.000Z",
      hasCheckAction: true,
      dueChip: { text: "12 days overdue", variant: "urgent" as const },
      originalActionItem: {
        id: "item-1",
        contactId: "c-1",
        title: "Call Ada",
        dueAt: "2026-09-10T10:00:00.000Z",
        completedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    };
    const birthday = {
      ...followUp,
      id: "bday-c-2",
      kind: "birthday" as const,
      group: "birthdays" as const,
      contactId: "c-2",
      contactName: "Grace Hopper",
      title: "Wish Grace Hopper a happy birthday",
      dueAt: null,
      hasCheckAction: false,
      dueChip: { text: "Wednesday", variant: "neutral" as const },
      originalActionItem: undefined,
    };
    const catchUp = {
      ...followUp,
      id: "catch-c-3",
      kind: "catch-up" as const,
      group: "catch-up" as const,
      contactId: "c-3",
      contactName: "Alan Turing",
      title: "Check in with Alan Turing",
      dueAt: null,
      hasCheckAction: false,
      dueChip: { text: "3 weeks past due", variant: "neutral" as const },
      originalActionItem: undefined,
    };

    it("shows the name, the chip words, the title and when you last spoke", () => {
      vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0));
      render(
        <MemoryRouter>
          <ActionRow item={followUp} />
        </MemoryRouter>,
      );
      expect(
        screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href"),
      ).toBe("/contact/c-1");
      expect(screen.getByText("12 days overdue")).toBeDefined();
      expect(screen.getByText("Call Ada")).toBeDefined();
      expect(screen.getByText("Last spoke 5 days ago")).toBeDefined();
      // The chip is a fact in words: no border, no caps.
      const chip = screen.getByText("12 days overdue");
      expect(chip.className).not.toContain("uppercase");
      expect(chip.className).not.toContain("border");
      // The check's ring at rest is the measured one, a step under hover.
      const check = screen.getByRole("button", {
        name: 'Mark "Call Ada" done',
      });
      expect(check.className).toContain(CHECK_RING_REST);
      expect(check.className).toContain("hover:border-current");
    });

    it("opens the contact from a click on the row, and not from a click on the check", async () => {
      const onOpenContact = vi.fn();
      const onComplete = vi.fn();
      const onSelect = vi.fn();
      render(
        <MemoryRouter>
          <ActionRow
            item={followUp}
            onSelect={onSelect}
            onOpenContact={onOpenContact}
            onComplete={onComplete}
          />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByText("Call Ada"));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onOpenContact).toHaveBeenCalledWith("c-1");

      fireEvent.click(screen.getByRole("button", { name: /done/i }));
      await new Promise((r) => setTimeout(r, 300));
      expect(onComplete).toHaveBeenCalledWith("item-1");
      expect(onOpenContact).toHaveBeenCalledTimes(1);
    });

    it("has no Open profile button, and shows snooze only on a follow-up", () => {
      const { unmount } = render(
        <MemoryRouter>
          <ActionRow item={followUp} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole("link", { name: /Open profile/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Snooze item" })).toBeDefined();
      unmount();

      render(
        <MemoryRouter>
          <ActionRow item={birthday} />
          <ActionRow item={catchUp} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole("button", { name: "Snooze item" })).toBeNull();
      expect(
        screen.getByRole("button", {
          name: "Wish Grace Hopper a happy birthday",
        }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Log note for Alan Turing" }),
      ).toBeDefined();
      // The birthday row says when you last spoke. The catch-up's chip
      // already says how long it has been, so its row does not say it twice.
      expect(screen.getByText("3 weeks past due")).toBeDefined();
      expect(screen.getAllByText(/^Last spoke /)).toHaveLength(1);
    });

    it("wears the selected row's tint when it looks selected, with no ring, offset or scale", () => {
      const { rerender } = render(
        <MemoryRouter>
          <ActionRow item={followUp} isSelected looksSelected />
        </MemoryRouter>,
      );
      const row = screen.getByRole("listitem");
      expect(row.className).toContain("row-selected");
      // The resting wash would paint over the tint, so it steps aside.
      expect(row.className).not.toContain("bg-surface-container-low");
      expect(row.className).not.toMatch(/(?<![-\w])ring-/);
      expect(row.className).not.toContain("ring-offset");
      expect(row.className).not.toContain("scale-");
      expect(row.className).not.toContain("border-outline");

      // Unselected, the row keeps its wash, and the hover is the state layer.
      rerender(
        <MemoryRouter>
          <ActionRow item={followUp} />
        </MemoryRouter>,
      );
      expect(row.className).not.toContain("row-selected");
      expect(row.className).toContain("bg-surface-container-low/70");
      expect(row.className).toContain("state-layer");
      expect(row.className).not.toMatch(/hover:bg-/);
    });

    it("stays the current row without the tint when it only is selected", () => {
      render(
        <MemoryRouter>
          <ActionRow item={followUp} isSelected />
        </MemoryRouter>,
      );
      const row = screen.getByRole("listitem");
      // Current for the keys and a screen reader: the tab stop and aria-current.
      expect(row.getAttribute("aria-current")).toBe("true");
      expect(row.getAttribute("tabindex")).toBe("0");
      // Painted like any other row.
      expect(row.className).not.toContain("row-selected");
      expect(row.className).toContain("bg-surface-container-low/70");
    });

    it("snoozes from the menu", () => {
      render(
        <MemoryRouter>
          <ActionRow item={followUp} />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Snooze item" }));
      expect(screen.getByRole("menuitem", { name: "Tomorrow" })).toBeDefined();
      expect(
        screen.getByRole("menuitem", { name: "Next month" }),
      ).toBeDefined();
      fireEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
      expect(mockUpdateMutate).toHaveBeenCalledWith({
        id: "item-1",
        data: { dueAt: expect.any(String) },
      });
    });
  });

  describe("ComingUpCard", () => {
    const birthday = (contactId: string, name: string, daysUntil: number) => {
      const nextDate = new Date(2026, 8, 21 + daysUntil, 9);
      return {
        contactId,
        name,
        avatarUrl: null,
        themeColor: "#006a91",
        rawBirthday: "1990-01-01",
        isTracked: true,
        lastContactedAt: "2026-09-01T10:00:00.000Z",
        relationshipScore: 85,
        nextDate,
        daysUntil,
        turningAge: 36,
      };
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 8, 21, 9));
    });

    it("lists days eight to fourteen and the meetings as one dated list, and leaves a birthday in three days to Up next", () => {
      render(
        <MemoryRouter>
          <ComingUpCard
            birthdays={[
              birthday("c-1", "Ada Lovelace", 3),
              birthday("c-2", "Grace Hopper", 10),
            ]}
            meetings={[
              {
                title: "Sprint planning",
                startsAt: new Date(2026, 8, 23, 15).toISOString(),
                endsAt: new Date(2026, 8, 23, 16).toISOString(),
                contactIds: ["c-1"],
              },
            ]}
            contactsMap={
              new Map([["c-1", { name: "Ada Lovelace", avatarUrl: null }]])
            }
          />
        </MemoryRouter>,
      );
      // The meeting in two days comes before the birthday in ten.
      const rows = screen
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("Sprint planning");
      expect(rows[0]).toContain("Wednesday");
      expect(rows[1]).toContain("Grace Hopper");
      expect(rows[1]).toContain("Turns 36");
      expect(rows[1]).toContain("In 10 days");
      expect(screen.queryByText("Ada Lovelace")).toBeNull();
      expect(
        screen.getByRole("link", { name: /Grace Hopper/ }).getAttribute("href"),
      ).toBe("/contact/c-2");
      expect(
        screen.getByRole("heading", { level: 2, name: /^Coming up,\s?2$/ }),
      ).toBeDefined();
      expect(screen.queryByText("Birthdays")).toBeNull();
      expect(screen.queryByText("Meetings")).toBeNull();
    });

    it("is one line with the calendar door when nothing is in two weeks", () => {
      render(
        <MemoryRouter>
          <ComingUpCard birthdays={[birthday("c-1", "Ada Lovelace", 3)]} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Nothing in the next two weeks\./)).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: "Connect a calendar" })
          .getAttribute("href"),
      ).toBe("/settings/connectors");
      const card = document.querySelector('[data-card-id="coming-up"]');
      expect(card?.className).not.toContain("bg-surface-container-lowest");
    });
  });

  describe("InsightCard", () => {
    it("is the paragraph, the category and the Ask chip with the first sentence", () => {
      render(
        <MemoryRouter>
          <InsightCard
            isLoading={false}
            insight={{
              text: "Three people in Berlin went quiet this month. Two of them are founders you met at the summit.",
              category: "Relationship Maintenance",
              generatedAt: "2026-09-21T06:00:00.000Z",
            }}
          />
        </MemoryRouter>,
      );
      expect(
        screen.getByText(/Three people in Berlin went quiet/),
      ).toBeDefined();
      // The model's category, whole and in sentence case, on its own line
      // over the paragraph. The title's row holds the title alone.
      expect(screen.getByText("Relationship maintenance")).toBeDefined();
      expect(
        screen.getByRole("heading", { level: 2 }).parentElement!.textContent,
      ).toBe("Daily insight");
      expect(
        screen
          .getByRole("link", { name: "Ask about this insight" })
          .getAttribute("href"),
      ).toBe(
        `/search?q=${encodeURIComponent("Three people in Berlin went quiet this month")}`,
      );
      expect(screen.queryByText("Ask a follow-up")).toBeNull();
    });

    it("tells an admin to add a key, with the door", () => {
      render(
        <MemoryRouter>
          <InsightCard isLoading={false} insight={null} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Add an AI key to get one\./)).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: "Open AI settings" })
          .getAttribute("href"),
      ).toBe("/settings/admin/ai");
      const card = document.querySelector('[data-card-id="insight"]');
      expect(card?.className).not.toContain("bg-surface-container-lowest");
    });

    it("tells a member the admin has not added a key, with no door", () => {
      mockIsAdmin = false;
      render(
        <MemoryRouter>
          <InsightCard isLoading={false} insight={null} />
        </MemoryRouter>,
      );
      expect(
        screen.getByText("Your admin has not added an AI key yet."),
      ).toBeDefined();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("holds an insight's shape while the insight loads", () => {
      const { container } = render(
        <MemoryRouter>
          <InsightCard isLoading />
        </MemoryRouter>,
      );
      const section = container.querySelector(
        'section[data-card-id="insight"]',
      )!;
      // The card the skeleton drew, so the page lands at its height.
      expect(section.classList.contains("card")).toBe(true);
      expect(screen.getByText("Relationship maintenance")).toBeDefined();
      expect(screen.getByText("Loading").className).toContain("sr-only");
    });

    it("says AI is off, with the switch, when the account opted out", () => {
      render(
        <MemoryRouter>
          <InsightCard isLoading={false} insight={null} aiAllowed={false} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/AI is off for your account\./)).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: "Turn on in Settings" })
          .getAttribute("href"),
      ).toBe("/settings/privacy#ai-assist");
    });
  });

  describe("AskForm", () => {
    const Landing = () => {
      const location = useLocation();
      return <div data-testid="search-landing">{location.search}</div>;
    };

    it("waits for three characters, then sends the question to /search", () => {
      render(
        <MemoryRouter initialEntries={["/pulse"]}>
          <Routes>
            <Route path="/pulse" element={<AskForm />} />
            <Route path="/search" element={<Landing />} />
          </Routes>
        </MemoryRouter>,
      );
      const form = screen.getByRole("search", {
        name: "Ask about your network",
      });
      const input = screen.getByRole("searchbox", {
        name: "Ask about your network",
      });
      const ask = screen.getByRole("button", { name: "Ask" });
      expect(ask.hasAttribute("disabled")).toBe(true);

      fireEvent.change(input, { target: { value: "ab" } });
      expect(ask.hasAttribute("disabled")).toBe(true);
      fireEvent.submit(form);
      expect(screen.queryByTestId("search-landing")).toBeNull();

      fireEvent.change(input, {
        target: { value: "  who works in Berlin?  " },
      });
      expect(ask.hasAttribute("disabled")).toBe(false);
      fireEvent.submit(form);
      expect(screen.getByTestId("search-landing").textContent).toBe(
        "?q=who%20works%20in%20Berlin%3F",
      );
    });
  });

  describe("Masthead", () => {
    const counts = {
      overdue: 2,
      dueToday: 3,
      birthdaysThisWeek: 1,
      queued: 6,
      streak: 5,
    };

    const renderMasthead = (
      over: Partial<React.ComponentProps<typeof Masthead>> = {},
    ) => {
      const onJumpTo = vi.fn();
      const onToggleCustomize = vi.fn();
      render(
        <MemoryRouter>
          <Masthead
            counts={counts}
            isEditing={false}
            onToggleCustomize={onToggleCustomize}
            onJumpTo={onJumpTo}
            {...over}
          />
        </MemoryRouter>,
      );
      return { onJumpTo, onToggleCustomize };
    };

    it("titles the page Pulse with the day beside it, and one sentence", () => {
      const monday = new Date(2026, 8, 21, 9, 0, 0);
      vi.setSystemTime(monday);
      stubMatchMedia(true);
      renderMasthead();

      const heading = screen.getByRole("heading", { level: 1, name: "Pulse" });
      expect(heading.className).toContain(PAGE_TITLE);
      const weekday = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
      }).format(monday);
      const header = screen.getByLabelText("Today summary");
      expect(header.tagName).toBe("HEADER");
      const dateLine = Array.from(header.querySelectorAll("p")).find((p) =>
        p.textContent?.includes(weekday),
      );
      expect(dateLine).toBeDefined();
      // The day continues the title line at the title's size in the variant
      // ink. It is a paragraph, not part of the h1.
      expect(dateLine?.className).toContain(PAGE_TITLE_SUFFIX);
      expect(heading.contains(dateLine!)).toBe(false);
      expect(header.textContent).toContain(
        "2 overdue, 3 due today, 1 birthday this week. 5 days in a row.",
      );
      // No progress ring: the sentence already says the counts.
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("renders each count as a button that jumps to its card from sm up", () => {
      stubMatchMedia(true);
      const { onJumpTo } = renderMasthead();

      fireEvent.click(screen.getByRole("button", { name: "2 overdue" }));
      expect(onJumpTo).toHaveBeenLastCalledWith("overdue");
      fireEvent.click(screen.getByRole("button", { name: "3 due today" }));
      expect(onJumpTo).toHaveBeenLastCalledWith("today");
      fireEvent.click(
        screen.getByRole("button", { name: "1 birthday this week" }),
      );
      expect(onJumpTo).toHaveBeenLastCalledWith("birthdays");
      // The period and the streak are not buttons.
      expect(
        screen.queryByRole("button", { name: /days in a row/ }),
      ).toBeNull();
    });

    it("renders the counts as plain text below sm", () => {
      stubMatchMedia(false);
      renderMasthead();

      expect(screen.queryByRole("button", { name: "2 overdue" })).toBeNull();
      expect(screen.queryByRole("button", { name: "3 due today" })).toBeNull();
      const header = screen.getByLabelText("Today summary");
      expect(header.textContent).toContain(
        "2 overdue, 3 due today, 1 birthday this week.",
      );
      // The only buttons are the two actions and the menu trigger.
      const names = screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
      expect(names).toEqual(["Log note", "More"]);
    });

    it("keeps Log note as the one primary, with New contact and Customize layout in the More menu", () => {
      stubMatchMedia(true);
      const { onToggleCustomize } = renderMasthead();

      const logNote = screen.getByRole("button", { name: "Log note" });
      expect(logNote.className).toContain("btn-primary");
      expect(screen.queryByRole("button", { name: "New contact" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Customize/ })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "More" }));
      expect(
        screen.getByRole("menuitem", { name: "New contact" }),
      ).toBeDefined();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Customize layout" }),
      );
      expect(onToggleCustomize).toHaveBeenCalledTimes(1);
    });

    it("names the customize item for the state while editing", () => {
      stubMatchMedia(true);
      renderMasthead({ isEditing: true });
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      expect(
        screen.getByRole("menuitem", { name: "Done editing layout" }),
      ).toBeDefined();
    });

    it("leaves the sentence out when quiet, and keeps the title, the day and the actions", () => {
      const monday = new Date(2026, 8, 21, 9, 0, 0);
      vi.setSystemTime(monday);
      stubMatchMedia(true);
      renderMasthead({ quiet: true });
      const header = screen.getByLabelText("Today summary");
      expect(header.textContent).not.toContain("overdue");
      expect(header.textContent).toContain(
        new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(monday),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "Pulse" }),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Log note" })).toBeDefined();
    });

    it("renders children under the sentence", () => {
      stubMatchMedia(true);
      renderMasthead({ children: <div data-testid="masthead-slot" /> });
      expect(screen.getByTestId("masthead-slot")).toBeDefined();
    });
  });

  describe("Enter belongs to the control that has focus", () => {
    it("does not open the highlighted contact when Enter lands on a menu item", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      expect(
        screen.getAllByRole("listitem")[0].getAttribute("aria-current"),
      ).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "More" }));
      const item = screen.getByRole("menuitem", { name: "Customize layout" });
      item.focus();
      fireEvent.keyDown(item, { key: "Enter" });

      expect(screen.queryByTestId("contact-marker")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 1, name: "Pulse" }),
      ).toBeDefined();
    });

    it("does not open the highlighted contact from a bare Enter on the page", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      fireEvent.keyDown(window, { key: "Enter" });
      expect(screen.queryByTestId("contact-marker")).toBeNull();
    });

    it("opens the contact from Enter on the focused row", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      expect(rows[0].getAttribute("tabindex")).toBe("0");
      expect(rows[1].getAttribute("tabindex")).toBe("-1");
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: "Enter" });
      expect(screen.getByTestId("contact-marker")).toBeDefined();
    });

    it("moves the highlight with ArrowDown and ArrowUp from a focused row", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: "ArrowDown" });
      expect(rows[1].getAttribute("aria-current")).toBe("true");
      expect(rows[0].getAttribute("aria-current")).toBeNull();
      expect(rows[1].getAttribute("tabindex")).toBe("0");
      // Focus was inside the list, so the new row takes it.
      expect(document.activeElement).toBe(rows[1]);
      fireEvent.keyDown(rows[1], { key: "ArrowUp" });
      expect(rows[0].getAttribute("aria-current")).toBe("true");
      // The first row stays put on ArrowUp.
      fireEvent.keyDown(rows[0], { key: "ArrowUp" });
      expect(rows[0].getAttribute("aria-current")).toBe("true");
    });

    it("completes the highlighted follow-up with Space on the row", async () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: " " });
      await new Promise((r) => setTimeout(r, 300));
      expect(mockCompleteMutate).toHaveBeenCalledWith("act-1");
      expect(screen.queryByTestId("contact-marker")).toBeNull();
    });

    it("tints the current row only after a queue key, and not after focus leaves the list", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      const tinted = () =>
        rows.filter((row) => row.className.includes("row-selected"));

      // On load the first row is current, and nothing looks selected.
      expect(rows[0].getAttribute("aria-current")).toBe("true");
      expect(rows[0].getAttribute("tabindex")).toBe("0");
      expect(tinted()).toHaveLength(0);

      // The first J shows the current row and does not move it. The next
      // J moves it.
      fireEvent.keyDown(window, { key: "j" });
      expect(rows[0].getAttribute("aria-current")).toBe("true");
      expect(tinted()).toEqual([rows[0]]);
      fireEvent.keyDown(window, { key: "j" });
      expect(rows[1].getAttribute("aria-current")).toBe("true");
      expect(tinted()).toEqual([rows[1]]);

      // Focus that leaves the list takes the tint with it. The row stays
      // current.
      act(() => rows[1].focus());
      act(() => screen.getByRole("button", { name: "More" }).focus());
      expect(tinted()).toHaveLength(0);
      expect(rows[1].getAttribute("aria-current")).toBe("true");

      // Focus that is not the keyboard's, the way a click puts it on the
      // current row's check, does not light the row up. jsdom never matches
      // `:focus-visible` for a scripted focus, so this is that focus.
      const currentCheck = screen.getByRole("button", {
        name: 'Mark "Prep coffee meeting" done',
      });
      expect(rows[1].contains(currentCheck)).toBe(true);
      act(() => currentCheck.focus());
      expect(tinted()).toHaveLength(0);
    });

    it("makes the row that focus enters current, and keyboard focus tints it and speaks it", () => {
      stubMatchMedia(true);
      // jsdom never matches `:focus-visible`, so the focused element stands
      // in for keyboard focus here.
      const matches = Element.prototype.matches;
      const spy = vi
        .spyOn(Element.prototype, "matches")
        .mockImplementation(function (this: Element, selector: string) {
          return selector === ":focus-visible"
            ? this === document.activeElement
            : matches.call(this, selector);
        });
      try {
        renderPulseWithContactRoute();
        const rows = screen.getAllByRole("listitem");
        expect(rows[0].getAttribute("aria-current")).toBe("true");

        // Tab walks past the first row's controls onto the second row's
        // check. That row becomes the current row, the one J and K move.
        const check = screen.getByRole("button", {
          name: 'Mark "Prep coffee meeting" done',
        });
        act(() => check.focus());
        expect(rows[1].getAttribute("aria-current")).toBe("true");
        expect(rows[0].getAttribute("aria-current")).toBeNull();
        expect(rows[1].getAttribute("tabindex")).toBe("0");
        expect(rows[0].getAttribute("tabindex")).toBe("-1");
        // The tint follows, with the name's ink, and the status says so.
        expect(rows[1].className).toContain("row-selected");
        expect(rows[0].className).not.toContain("row-selected");
        expect(
          within(rows[1])
            .getByRole("link", { name: "Grace Hopper" })
            .className.split(" "),
        ).toContain("text-on-primary-wash");
        expect(
          screen.getByText("Row 2 of 3, Grace Hopper, today"),
        ).toBeDefined();
        // The row does not take focus back from its check.
        expect(document.activeElement).toBe(check);

        // J goes on from the row that focus is in.
        fireEvent.keyDown(window, { key: "j" });
        expect(rows[2].getAttribute("aria-current")).toBe("true");
      } finally {
        spy.mockRestore();
      }
    });

    it("takes the tint away on a pointer press outside the list, and keeps it for a press inside", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      const tinted = () =>
        rows.filter((row) => row.className.includes("row-selected"));

      // J with focus on the page shows the current row, and a second J
      // moves it.
      fireEvent.keyDown(window, { key: "j" });
      expect(tinted()).toEqual([rows[0]]);
      fireEvent.keyDown(window, { key: "j" });
      expect(tinted()).toEqual([rows[1]]);

      // A press inside the list keeps it.
      fireEvent.pointerDown(rows[2]);
      expect(tinted()).toEqual([rows[1]]);

      // A press anywhere else takes it away, as focus leaving the list
      // does, and the row stays current. The status goes quiet with it.
      fireEvent.pointerDown(
        screen.getByRole("heading", { level: 1, name: "Pulse" }),
      );
      expect(tinted()).toHaveLength(0);
      expect(rows[1].getAttribute("aria-current")).toBe("true");
      expect(screen.queryByText(/^Row 2 of 3/)).toBeNull();

      // The next queue key shows it again where it was, and moves nothing.
      fireEvent.keyDown(window, { key: "k" });
      expect(tinted()).toEqual([rows[1]]);
      expect(rows[1].getAttribute("aria-current")).toBe("true");
    });

    it("leaves a key alone when a control inside the row has focus", () => {
      stubMatchMedia(true);
      renderPulseWithContactRoute();
      const rows = screen.getAllByRole("listitem");
      const check = screen.getByRole("button", {
        name: 'Mark "Send whitepaper" done',
      });
      check.focus();
      fireEvent.keyDown(check, { key: "Enter" });
      fireEvent.keyDown(check, { key: "ArrowDown" });
      expect(screen.queryByTestId("contact-marker")).toBeNull();
      expect(rows[0].getAttribute("aria-current")).toBe("true");
    });
  });

  describe("CardFrame", () => {
    it("renders the count as muted text inside the heading, with no hairline", () => {
      const { container } = render(
        <CardFrame cardId="up-next" title="Up next" count={10}>
          <p>Body</p>
        </CardFrame>,
      );
      // The name is "Up next, 10" in a browser. jsdom's name computation
      // drops the space inside the inline span, so the match allows both.
      expect(
        screen.getByRole("heading", { level: 2, name: /^Up next,\s?10$/ }),
      ).toBeDefined();
      const section = container.querySelector('[data-card-id="up-next"]')!;
      expect(section.getAttribute("aria-labelledby")).toBe(
        "card-heading-up-next",
      );
      expect(section.innerHTML).not.toContain("border-b");
    });

    it("variant line puts the title, the count and the sentence on one row", () => {
      const { container } = render(
        <CardFrame
          cardId="completed"
          title="Completed"
          count={0}
          variant="line"
        >
          Nothing completed yet.
        </CardFrame>,
      );
      const section = container.querySelector(
        'section[data-card-id="completed"]',
      )!;
      expect(section).not.toBeNull();
      expect(section.className).toContain("flex-wrap");
      expect(section.className).not.toContain("bg-surface-container-lowest");
      expect(
        screen.getByRole("heading", { level: 2, name: /^Completed,\s?0$/ }),
      ).toBeDefined();
      const sentence = screen.getByText("Nothing completed yet.");
      // The heading and the sentence share the row.
      expect(sentence.parentElement).toBe(section);
      expect(screen.getByRole("heading", { level: 2 }).parentElement).toBe(
        section,
      );
    });

    it("variant line shows the customize controls when editing", () => {
      const onHide = vi.fn();
      const onMoveStep = vi.fn();
      render(
        <CardCustomizeContext.Provider
          value={{
            isEditing: true,
            cardId: "completed",
            column: "focus",
            index: 0,
            totalInColumn: 2,
            onHide,
            onMoveToColumn: vi.fn(),
            onMoveStep,
          }}
        >
          <CardFrame cardId="completed" title="Completed" variant="line">
            Nothing completed yet.
          </CardFrame>
        </CardCustomizeContext.Provider>,
      );
      expect(
        screen.getByRole("button", { name: "Drag Completed to reorder" }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Move Completed" }),
      ).toBeDefined();
      fireEvent.click(
        screen.getByRole("button", { name: "Move Completed down" }),
      );
      expect(onMoveStep).toHaveBeenCalledWith("completed", 1);
      fireEvent.click(screen.getByRole("button", { name: "Hide Completed" }));
      expect(onHide).toHaveBeenCalledWith("completed");

      // The words keep their place out of sight and the controls sit over
      // the end of the title's row, so the line keeps its height.
      expect(screen.getByText("Nothing completed yet.").className).toContain(
        "invisible",
      );
      expect(
        screen.getByRole("button", { name: "Hide Completed" }).parentElement!
          .className,
      ).toContain("absolute");
    });

    it("keeps a card's header the same height when the customize controls appear", () => {
      render(
        <CardCustomizeContext.Provider
          value={{
            isEditing: true,
            cardId: "inbox",
            column: "intel",
            index: 0,
            totalInColumn: 2,
            onHide: vi.fn(),
            onMoveToColumn: vi.fn(),
            onMoveStep: vi.fn(),
          }}
        >
          <CardFrame cardId="inbox" title="Inbox" count={2}>
            <p>Body</p>
          </CardFrame>
        </CardCustomizeContext.Provider>,
      );
      // Every header's row is 24 px, the height of a header action, and
      // the 32 px buttons give back 8 px of margin to fit it.
      expect(
        screen.getByRole("heading", { level: 2 }).parentElement!.className,
      ).toContain("min-h-6");
      expect(
        screen.getByRole("button", { name: "Hide Inbox" }).parentElement!
          .className,
      ).toContain("-my-1");
    });
  });

  describe("CompletedCard", () => {
    it("is one line that says how many, and Show opens the list under it", () => {
      const { container } = render(
        <MemoryRouter>
          <CompletedCard />
        </MemoryRouter>,
      );
      const section = container.querySelector(
        'section[data-card-id="completed"]',
      )!;
      expect(section.className).toContain("flex-wrap");
      expect(screen.getByText("1 completed recently")).toBeDefined();
      const show = screen.getByRole("button", { name: "Show" });
      expect(show.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Sent follow up email")).toBeNull();

      fireEvent.click(show);
      const list = screen.getByRole("list", { name: "Completed follow-ups" });
      expect(list.id).toBe("completed-card-content");
      expect(screen.getByText("Sent follow up email")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href"),
      ).toBe("/contact/c-1");
      const hide = screen.getByRole("button", { name: "Hide" });
      expect(hide.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(hide);
      expect(screen.queryByText("Sent follow up email")).toBeNull();
    });

    it("says nothing completed yet, with no Show, when the list is empty", () => {
      mockCompletedItems = [];
      render(
        <MemoryRouter>
          <CompletedCard />
        </MemoryRouter>,
      );
      expect(screen.getByText("Nothing completed yet.")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
    });
  });

  describe("ActivityCard", () => {
    const activity = {
      days: [{ day: "2026-09-17", count: 3, byType: { note: 2, call: 1 } }],
      weekTotals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      prevWeekTotals: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      streak: { current: 5, best: 14, lastDay: "2026-09-17" },
      today: { logged: 3, completed: 1, due: 0 },
      thisWeek: { logged: 12, byType: { note: 8, call: 4 } },
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 8, 21, 9));
    });

    it("draws the heatmap with month labels and weekday letters, and no streak", () => {
      const { container } = render(<ActivityCard activity={activity} />);
      expect(screen.getByText("Activity")).toBeDefined();
      expect(screen.queryByTitle("Days you logged something")).toBeNull();
      expect(screen.queryByText(/best 14/)).toBeNull();
      // Twelve weeks of squares that scale to the card.
      const svg = container.querySelector('svg[role="img"]');
      expect(svg?.getAttribute("width")).toBe("100%");
      expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
      expect(container.querySelectorAll("[data-heatmap-cell]")).toHaveLength(
        84,
      );
      expect(container.querySelectorAll("svg title")).toHaveLength(0);
      // Monday start: M, W and F on rows 0, 2 and 4.
      const letters = Array.from(
        container.querySelectorAll(".grid-rows-7 > span"),
      ).map((el) => el.textContent);
      expect(letters).toEqual(["M", "", "W", "", "F", "", ""]);
      // The current month is labelled, and the one before it.
      expect(screen.getByText("Sep")).toBeDefined();
      expect(screen.getByText("Aug")).toBeDefined();
    });

    it("shows one tooltip with the day's words on hover, and hides it when the pointer leaves", () => {
      const { container } = render(<ActivityCard activity={activity} />);
      const cell = container.querySelector('[data-heatmap-cell="2026-09-17"]')!;
      expect(container.querySelector("[data-heatmap-tooltip]")).toBeNull();

      // React derives onPointerEnter from the over event, so that is the one to fire.
      fireEvent.pointerOver(cell, { pointerType: "mouse" });
      const tip = container.querySelector("[data-heatmap-tooltip]");
      expect(tip?.textContent).toMatch(/Sep 17: 2 notes, 1 call$/);
      // The same words are in the hidden list.
      expect(
        screen.getAllByText(/Sep 17: 2 notes, 1 call$/).length,
      ).toBeGreaterThanOrEqual(2);

      fireEvent.pointerOut(container.querySelector('svg[role="img"]')!, {
        pointerType: "mouse",
        relatedTarget: document.body,
      });
      expect(container.querySelector("[data-heatmap-tooltip]")).toBeNull();
    });

    it("toggles the tooltip with a tap, and a second tap on the same square hides it", () => {
      const { container } = render(<ActivityCard activity={activity} />);
      const cell = container.querySelector('[data-heatmap-cell="2026-09-17"]')!;
      fireEvent.pointerDown(cell, { pointerType: "touch" });
      expect(container.querySelector("[data-heatmap-tooltip]")).not.toBeNull();
      fireEvent.pointerDown(cell, { pointerType: "touch" });
      expect(container.querySelector("[data-heatmap-tooltip]")).toBeNull();
      // A tap elsewhere hides it too.
      fireEvent.pointerDown(cell, { pointerType: "touch" });
      fireEvent.pointerDown(document.body, { pointerType: "touch" });
      expect(container.querySelector("[data-heatmap-tooltip]")).toBeNull();
    });

    it("draws the sparkline at its measured width, and says the four weeks and this week", () => {
      const rect = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({
          width: 300,
          height: 40,
          top: 0,
          left: 0,
          right: 300,
          bottom: 40,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect);
      const { container } = render(<ActivityCard activity={activity} />);
      const spark = container.querySelector("svg[data-sparkline]");
      expect(spark?.getAttribute("viewBox")).toBe("0 0 300 40");
      expect(spark?.getAttribute("width")).toBe("300");
      expect(spark?.hasAttribute("preserveAspectRatio")).toBe(false);
      expect(spark?.querySelector("circle")).not.toBeNull();
      // 9+10+11+12 = 42 against 5+6+7+8 = 26: +62%.
      expect(screen.getByText("42")).toBeDefined();
      expect(screen.getByText(/in the last four weeks/)).toBeDefined();
      expect(screen.getByText("+62% on the four before")).toBeDefined();
      expect(screen.getByText("This week: 8 notes, 4 calls")).toBeDefined();
      rect.mockRestore();
    });
  });

  describe("KeepingUpCard", () => {
    const tracking = {
      count: 42,
      bands: { strong: 30, fading: 8, atRisk: 4, unscored: 0 },
      catchUpCount: 11,
      startedLast30d: 5,
      snapshotWeeks: 6,
      rising: [
        {
          id: "m-1",
          name: "Ada Lovelace",
          company: "Analytical Engines",
          avatarUrl: null,
          themeColor: "#006a91",
          relationshipScore: 85,
          lastContactedAt: "2026-09-01T10:00:00.000Z",
          score: 85,
          delta: 12,
        },
      ],
      cooling: [
        {
          id: "m-2",
          name: "Charles Babbage",
          company: "Difference Engine",
          avatarUrl: null,
          themeColor: "#046b4e",
          relationshipScore: 60,
          lastContactedAt: "2026-08-20T10:00:00.000Z",
          score: 60,
          delta: -8,
        },
      ],
    };

    it("names the bar, links the legend to the groups, and says the number", () => {
      render(
        <MemoryRouter>
          <KeepingUpCard tracking={tracking} />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("img", {
          name: "42 tracked: 30 strong, 8 fading, 4 at risk, 0 with no interactions yet",
        }),
      ).toBeDefined();
      const legend = [
        ["30 Strong", "/tracked#strong"],
        ["8 Fading", "/tracked#fading"],
        ["4 At risk", "/tracked#at-risk"],
      ] as const;
      for (const [name, href] of legend) {
        expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
          href,
        );
      }
      // A state with nobody in it has no legend entry.
      expect(
        screen.queryByRole("link", { name: /No interactions yet/ }),
      ).toBeNull();
      expect(screen.getByText("31")).toBeDefined();
      expect(screen.getByText("of 42 within cadence")).toBeDefined();
      expect(
        screen.getByRole("button", { name: "11 to catch up" }),
      ).toBeDefined();
      expect(screen.queryByText(/in the last 30 days/)).toBeNull();
    });

    it("hides Rising and Cooling before four snapshot weeks, and the catch-up button at zero", () => {
      render(
        <MemoryRouter>
          <KeepingUpCard
            tracking={{ ...tracking, snapshotWeeks: 3, catchUpCount: 0 }}
          />
        </MemoryRouter>,
      );
      expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
      expect(screen.queryByText(/four weeks/)).toBeNull();
      expect(screen.queryByRole("button", { name: /to catch up/ })).toBeNull();
      // Everybody is within cadence: the figure is the count.
      expect(document.querySelector(".font-headline")?.textContent).toBe("42");
      expect(screen.getByText("of 42 within cadence")).toBeDefined();
    });

    it("shows rising and cooling rows with their deltas, and rings that draw an arc", () => {
      const { container } = render(
        <MemoryRouter>
          <KeepingUpCard tracking={tracking} />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("heading", { level: 3, name: "Rising" }),
      ).toBeDefined();
      expect(screen.getByText("+12")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href"),
      ).toBe("/contact/m-1");
      expect(
        screen.getByRole("heading", { level: 3, name: "Cooling" }),
      ).toBeDefined();
      expect(screen.getByText("−8")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Charles Babbage" }),
      ).toBeDefined();
      // The rows carry the flag, the score and the date, so the ring draws.
      const bands = Array.from(
        container.querySelectorAll("[data-score-band]"),
      ).map((el) => el.getAttribute("data-score-band"));
      expect(bands).toEqual(["strong", "fading"]);
      expect(screen.queryByText(/four weeks/)).toBeNull();
    });

    it("says None this month for an empty column", () => {
      render(
        <MemoryRouter>
          <KeepingUpCard tracking={{ ...tracking, cooling: [] }} />
        </MemoryRouter>,
      );
      expect(screen.getByText("None this month")).toBeDefined();
    });

    it("shows the empty state with one button when nobody is tracked", () => {
      render(
        <MemoryRouter>
          <KeepingUpCard
            tracking={{
              ...tracking,
              count: 0,
              bands: { strong: 0, fading: 0, atRisk: 0, unscored: 0 },
              catchUpCount: 0,
              startedLast30d: 0,
              rising: [],
              cooling: [],
            }}
          />
        </MemoryRouter>,
      );
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: "Nobody is tracked yet",
        }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Choose people" }),
      ).toBeDefined();
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  it("renders CompositionCard with donut legend filterPill links and opens modal", async () => {
    const dummyDashboard = {
      industryComposition: [
        { industry: "Technology", count: 15 },
        { industry: "Education", count: 8 },
        { industry: "Healthcare", count: 4 },
      ],
      roleComposition: [
        { role: "Founder", count: 12 },
        { role: "Engineer", count: 10 },
      ],
      locationComposition: [{ location: "London", count: 20 }],
    } as unknown as DashboardPayload;

    render(
      <MemoryRouter>
        <CompositionCard dashboard={dummyDashboard} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Composition")).toBeDefined();
    expect(screen.getByText("Technology")).toBeDefined();
    expect(screen.getByText("15")).toBeDefined();

    // The legend is a list of links to the filtered list, "Technology 15".
    const techLink = screen.getByRole("link", { name: "Technology 15" });
    expect(techLink.getAttribute("href")).toBe("/?q=industry:Technology");
    expect(techLink.closest("ul")).not.toBeNull();
    // One hue: every slice is the primary at a step of opacity.
    const slices = Array.from(
      document.querySelectorAll('svg[role="img"] circle'),
    ).slice(1);
    expect(slices.map((c) => c.getAttribute("stroke"))).toEqual([
      "var(--color-primary)",
      "var(--color-primary)",
      "var(--color-primary)",
    ]);
    expect(slices.map((c) => c.getAttribute("stroke-opacity"))).toEqual([
      "1",
      "0.82",
      "0.64",
    ]);
    expect(
      document.querySelector('svg[role="img"]')?.getAttribute("width"),
    ).toBe("96");

    // Switch Segmented control to Role
    const roleRadio = screen.getByRole("radio", { name: "Role" });
    fireEvent.click(roleRadio);

    expect(screen.getByText("Founder")).toBeDefined();
    const founderLink = screen.getByRole("link", { name: /Founder/i });
    expect(founderLink.getAttribute("href")).toBe("/?q=role:Founder");

    // Click "See all" to open NetworkCompositionModal
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(await screen.findByTestId("composition-modal")).toBeDefined();
  });

  it("renders InboxCard with multiple items and toggles ghosts", () => {
    render(
      <MemoryRouter>
        <InboxCard
          pendingDuplicates={3}
          ghosts={[
            { id: "g-1", name: "Ghost One", avatarUrl: null, company: null },
          ]}
          hygiene={{
            missingCompany: 4,
            missingLocation: 2,
            missingEmail: 1,
            stale: 2,
          }}
          correspondents={5}
        />
      </MemoryRouter>,
    );
    const rows = [
      ["Review 3 possible duplicates", "/pulse/duplicates"],
      ["2 contacts have stale data", "/?q=updated:>6m"],
      ["4 without a company", "/?q=missing:company"],
      ["2 without a location", "/?q=missing:location"],
      ["1 without an email", "/?q=missing:email"],
      ["5 people you talk to are not contacts", "/settings/connectors/people"],
    ] as const;
    for (const [name, href] of rows) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
        href,
      );
    }
    // No New people row without the prop, and the rows have no border.
    expect(screen.queryByText(/new this month/)).toBeNull();
    expect(
      screen.getByRole("link", { name: "4 without a company" }).className,
    ).not.toMatch(/border-outline/);

    const ghostBtn = screen.getByRole("button", {
      name: "1 person is mentioned but not in your network",
    });
    expect(ghostBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ghostBtn);
    expect(ghostBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Ghost One" })).toBeDefined();
  });

  it("toggles customize mode from the More menu and the C key, and shows no tray with nothing hidden", () => {
    stubMatchMedia(true);
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Initial state: no Customize button in the header, nothing editing
    expect(screen.queryByRole("button", { name: /Customize/ })).toBeNull();
    expect(screen.queryByText("Editing layout")).toBeNull();

    // Choose Customize layout from More to enter customize mode
    openCustomize();
    expect(screen.getByText("Editing layout")).toBeDefined();
    expect(screen.getByText("Layout editing on")).toBeDefined();
    // The tray waits for a hidden card.
    expect(screen.queryByTestId("hidden-cards-tray")).toBeNull();
    expect(
      screen.getByText("Drag a card to move it. Use the eye to hide one."),
    ).toBeDefined();

    // Press 'c' to toggle customize mode off
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.queryByText("Editing layout")).toBeNull();
    expect(screen.getByText("Layout editing off")).toBeDefined();

    // Press 'c' to toggle back on
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByText("Editing layout")).toBeDefined();

    // Click 'Done' button in floating bar to exit
    const doneBtn = screen.getByRole("button", { name: "Done" });
    fireEvent.click(doneBtn);
    expect(screen.queryByText("Editing layout")).toBeNull();
  });

  it("hides card using eye toggle and restores from hidden tray", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Enter customize mode
    openCustomize();

    // Find eye toggle for the Keeping up card
    const hideKeepingUpBtn = screen.getByRole("button", {
      name: "Hide Keeping up",
    });
    fireEvent.click(hideKeepingUpBtn);

    // Verify setPreference was called with hide action result
    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        hidden: ["keeping-up"],
      }),
    );
  });

  it("resets layout when Reset layout button is clicked, and shows the tray for the hidden cards", () => {
    mockPreferences.pulseLayout = {
      hidden: ["keeping-up", "insight"],
      order: { focus: ["up-next"], network: [], intel: [] },
    };

    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Enter customize mode
    openCustomize();
    const tray = screen.getByTestId("hidden-cards-tray");
    expect(tray.textContent).toContain("Keeping up");
    expect(tray.textContent).toContain("Daily insight");

    const resetBtn = screen.getByRole("button", { name: "Reset layout" });
    fireEvent.click(resetBtn);

    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        hidden: [],
        order: expect.objectContaining({
          focus: ["up-next", "completed"],
          network: ["keeping-up", "activity"],
          intel: ["insight", "inbox", "coming-up", "composition"],
        }),
      }),
    );
  });

  it("moves card to another column via ActionMenu", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Enter customize mode
    openCustomize();

    // Open ActionMenu on the Keeping up card
    const moveMenuBtn = screen.getByRole("button", { name: "Move Keeping up" });
    fireEvent.click(moveMenuBtn);

    // Choose "Move to Focus"
    const moveToFocusItem = screen.getByRole("menuitem", {
      name: "Move to Focus",
    });
    fireEvent.click(moveToFocusItem);

    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        order: expect.objectContaining({
          focus: expect.arrayContaining(["keeping-up"]),
        }),
      }),
    );
  });

  it("moves card up and down via mobile arrow buttons", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Enter customize mode
    openCustomize();

    // Move Activity up (the network column is keeping-up, activity)
    const moveUpBtn = screen.getByRole("button", { name: "Move Activity up" });
    fireEvent.click(moveUpBtn);

    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        order: expect.objectContaining({
          network: ["activity", "keeping-up"],
        }),
      }),
    );
  });
});
