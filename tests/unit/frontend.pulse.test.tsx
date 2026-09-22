// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PulseView } from "../../src/views/pulse/PulseView";
import { PulseSkeleton } from "../../src/views/pulse/components/PulseSkeleton";
import { DuplicatesPage } from "../../src/views/pulse/pages/DuplicatesPage";
import { ActionRow } from "../../src/views/pulse/cards/ActionRow";
import { SnoozeMenu } from "../../src/views/pulse/cards/SnoozeMenu";
import { ComingUpCard } from "../../src/views/pulse/cards/ComingUpCard";
import { PulseHeader } from "../../src/views/pulse/components/PulseHeader";
import { CompletedCard } from "../../src/views/pulse/cards/CompletedCard";
import { NewPeopleCard } from "../../src/views/pulse/cards/NewPeopleCard";
import { InboxCard } from "../../src/views/pulse/cards/InboxCard";
import { ActivityCard } from "../../src/views/pulse/cards/ActivityCard";
import { KeepingUpCard } from "../../src/views/pulse/cards/KeepingUpCard";
import { CompositionCard } from "../../src/views/pulse/cards/CompositionCard";
import type { DashboardPayload } from "../../src/api";

vi.mock("../../src/views/dedupe/components", () => ({
  SuggestionReviewQueue: () => (
    <div data-testid="suggestion-review-queue">Mock Dedupe Queue</div>
  ),
}));

vi.mock("../../src/views/pulse/NetworkGrowthModal", () => ({
  NetworkGrowthModal: () => <div data-testid="growth-modal" />,
}));
vi.mock("../../src/views/pulse/NetworkCompositionModal", () => ({
  NetworkCompositionModal: () => <div data-testid="composition-modal" />,
}));

const mockCompleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockSetPreference = vi.fn();
let mockDashboardData: DashboardPayload | null = null;
let mockPreferences: {
  pulseLayout: { hidden: string[]; order: Record<string, string[]> };
  singleKeyShortcuts: boolean;
} = {
  pulseLayout: { hidden: [], order: {} },
  singleKeyShortcuts: true,
};

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
    data: [
      {
        id: "c-1",
        name: "Ada Lovelace",
        avatarUrl: null,
        themeColor: "#006a91",
        birthday: "1990-09-19",
      },
    ],
  }),
  useCompletedActionItems: () => ({
    data: [
      {
        id: "done-1",
        contactId: "c-1",
        contactName: "Ada Lovelace",
        title: "Sent follow up email",
        completedAt: "2026-09-17T14:00:00.000Z",
      },
    ],
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
  useAiAllowed: () => true,
}));

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({
    isAdmin: true,
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

describe("frontend.pulse", () => {
  beforeEach(() => {
    mockCompleteMutate.mockClear();
    mockUpdateMutate.mockClear();
    mockSetPreference.mockClear();
    mockDashboardData = createSampleDashboard();
    mockPreferences = {
      pulseLayout: { hidden: [], order: {} },
      singleKeyShortcuts: true,
    };
  });

  afterEach(() => {
    cleanup();
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

  it("renders nine cards by default", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const cards = container.querySelectorAll("[data-card-id]");
    expect(cards.length).toBe(9);

    const expectedCardIds = [
      "up-next",
      "completed",
      "insight",
      "inbox",
      "coming-up",
      "new-people",
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
    expect(cards.length).toBe(8);
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

    // Press 'j' to move highlight down to index 1 ("act-2")
    fireEvent.keyDown(window, { key: "j" });
    expect(listItems[1].getAttribute("aria-current")).toBe("true");

    // Press 'd' to complete highlighted item ("act-2")
    fireEvent.keyDown(window, { key: "d" });
    expect(mockCompleteMutate).toHaveBeenCalledWith("act-2");
  });

  it("shows 'Inbox zero. Nothing to clean up.' when inbox has no pending items", () => {
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

    expect(screen.getByText("Inbox zero. Nothing to clean up.")).toBeDefined();
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

  it("shows the Keeping up card on Pulse with the four-week line before four snapshot weeks", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("img", {
        name: "3 tracked: 1 strong, 1 fading, 1 at risk, 0 with no interactions yet",
      }),
    ).toBeDefined();
    expect(
      screen.getByText("2 of 3 within cadence, 1 to catch up"),
    ).toBeDefined();
    expect(
      screen.getByText("Rising and cooling show after four weeks of tracking."),
    ).toBeDefined();
    expect(screen.getByText("1 tracked in the last 30 days")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Manage" }).getAttribute("href"),
    ).toBe("/tracked");
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

    expect(screen.getByText("Set up your office")).toBeDefined();
    expect(screen.getByText("Import contacts")).toBeDefined();
    expect(screen.getByText("Log your first note")).toBeDefined();
    expect(screen.getByText("Connect AI")).toBeDefined();
  });

  it("renders PulseSkeleton", () => {
    const { container } = render(<PulseSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
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

  it("renders ActionRow and interacts with complete, log, and snooze", async () => {
    const onComplete = vi.fn();
    const onLog = vi.fn();
    const onSelect = vi.fn();
    const item = {
      id: "item-1",
      kind: "action_item" as const,
      group: "overdue" as const,
      contactId: "c-1",
      contactName: "Ada Lovelace",
      contactAvatarUrl: null,
      contactThemeColor: "#006a91",
      isTracked: false,
      relationshipScore: null,
      lastContactedAt: null,
      title: "Call Ada",
      dueAt: "2026-09-10T10:00:00.000Z",
      hasCheckAction: true,
      dueChip: { text: "Overdue", variant: "urgent" as const },
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

    const { getByRole, getByLabelText } = render(
      <MemoryRouter>
        <ActionRow
          item={item}
          isSelected={true}
          onSelect={onSelect}
          onComplete={onComplete}
          onLog={onLog}
        />
      </MemoryRouter>,
    );

    fireEvent.click(getByRole("button", { name: /done/i }));
    await new Promise((r) => setTimeout(r, 300));
    expect(onComplete).toHaveBeenCalledWith("item-1");

    fireEvent.click(getByLabelText(/snooze/i));
    expect(screen.getByText("Tomorrow")).toBeDefined();
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(mockUpdateMutate).toHaveBeenCalled();
  });

  it("renders SnoozeMenu and triggers snooze intervals", () => {
    const onClose = vi.fn();
    render(<SnoozeMenu itemId="item-1" isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText("In 3 days"));
    expect(mockUpdateMutate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders ComingUpCard with birthdays and meetings", () => {
    render(
      <MemoryRouter>
        <ComingUpCard
          birthdays={[
            {
              contactId: "c-1",
              name: "Ada Lovelace",
              avatarUrl: null,
              themeColor: "#006a91",
              rawBirthday: "1815-12-10",
              isTracked: true,
              lastContactedAt: "2026-09-01T10:00:00.000Z",
              relationshipScore: 85,
              nextDate: new Date(),
              daysUntil: 2,
              turningAge: 211,
            },
          ]}
          meetings={[
            {
              title: "Sprint Planning",
              startsAt: "2026-09-18T10:00:00.000Z",
              endsAt: "2026-09-18T11:00:00.000Z",
              contactIds: ["c-1"],
            },
          ]}
          contactsMap={
            new Map([
              ["c-1", { id: "c-1", name: "Ada Lovelace", avatarUrl: null }],
            ])
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Turning 211")).toBeDefined();
    expect(screen.getByText("Sprint Planning")).toBeDefined();
  });

  it("interacts with PulseHeader action buttons", () => {
    render(
      <MemoryRouter>
        <PulseHeader
          completedToday={2}
          dueToday={3}
          overdueCount={1}
          birthdayCount={1}
          streak={5}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /log a note/i }));
    fireEvent.click(screen.getByRole("button", { name: /new contact/i }));
    expect(screen.getByText(/2 of 6 done today/i)).toBeDefined();
  });

  it("renders CompletedCard and expands items", () => {
    render(
      <MemoryRouter>
        <CompletedCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/1 item completed recently/i)).toBeDefined();
    const expandBtn = screen.getByRole("button", {
      name: /expand completed items/i,
    });
    fireEvent.click(expandBtn);
    expect(screen.getByText("Sent follow up email")).toBeDefined();
    expect(screen.getByText("(Ada Lovelace)")).toBeDefined();

    // Collapse
    fireEvent.click(
      screen.getByRole("button", { name: /collapse completed items/i }),
    );
    expect(screen.getByText(/1 item completed recently/i)).toBeDefined();
  });

  it("renders NewPeopleCard and opens modal on click", async () => {
    render(
      <NewPeopleCard
        newContacts30d={6}
        recentlyAdded={[
          {
            id: "c-1",
            name: "Ada Lovelace",
            company: null,
            avatarUrl: null,
            themeColor: "#006a91",
            addedAt: "2026-09-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("6 added")).toBeDefined();
    expect(screen.getByText("+1")).toBeDefined();
    fireEvent.click(screen.getByText("Details"));
    expect(await screen.findByTestId("growth-modal")).toBeDefined();
  });

  it("renders ActivityCard with heatmap, sparkline, and streak tooltip", () => {
    const dummyActivity = {
      days: [{ day: "2026-09-17", count: 3, byType: { note: 2, call: 1 } }],
      weekTotals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      prevWeekTotals: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      streak: { current: 5, best: 14, lastDay: "2026-09-17" },
      today: { logged: 3, completed: 1, due: 0 },
      thisWeek: { logged: 12, byType: { note: 8, call: 4 } },
    };

    render(<ActivityCard activity={dummyActivity} />);
    expect(screen.getByText("Activity")).toBeDefined();
    expect(screen.getByTitle("Days you logged something")).toBeDefined();
    expect(screen.getByText(/5 days · best 14/)).toBeDefined();
    expect(screen.getByText(/8 notes/)).toBeDefined();
    expect(screen.getByText(/4 calls/)).toBeDefined();
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

    it("names the bar, links the legend to the groups, and says the two lines", () => {
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
      expect(
        screen.getByText("31 of 42 within cadence, 11 to catch up"),
      ).toBeDefined();
      expect(screen.getByText("5 tracked in the last 30 days")).toBeDefined();
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
    expect(screen.getByText("(15)")).toBeDefined();

    // Verify filterPill links have correct query target
    const techLink = screen.getByRole("link", { name: /Technology/i });
    expect(techLink.getAttribute("href")).toBe("/?q=industry:Technology");

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
    expect(screen.getByText(/Review 3 possible duplicates/i)).toBeDefined();
    expect(screen.getByText(/2 contacts have stale data/i)).toBeDefined();
    expect(screen.getByText(/4 without a company/i)).toBeDefined();
    expect(screen.getByText(/2 without a location/i)).toBeDefined();
    expect(screen.getByText(/1 without an email/i)).toBeDefined();
    expect(
      screen.getByText(/5 people you talk to are not contacts/i),
    ).toBeDefined();

    const ghostBtn = screen.getByText(
      /1 person is mentioned but not in your network/i,
    );
    fireEvent.click(ghostBtn);
    expect(screen.getByText("Ghost One")).toBeDefined();
  });

  it("toggles customize mode on Customize button click and C key press", () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    // Initial state: Customize button exists and is not active
    const customizeBtn = screen.getByRole("button", { name: "Customize" });
    expect(customizeBtn).toBeDefined();
    expect(screen.queryByText("Editing layout")).toBeNull();

    // Click Customize button to enter customize mode
    fireEvent.click(customizeBtn);
    expect(screen.getByText("Editing layout")).toBeDefined();
    expect(screen.getByText("Layout editing on")).toBeDefined();
    expect(screen.getByTestId("hidden-cards-tray")).toBeDefined();

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
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

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

  it("resets layout when Reset layout button is clicked", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    const resetBtn = screen.getByRole("button", { name: "Reset layout" });
    fireEvent.click(resetBtn);

    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        hidden: [],
        order: expect.objectContaining({
          focus: ["up-next", "completed"],
          network: ["keeping-up", "activity", "composition"],
          intel: ["insight", "inbox", "coming-up", "new-people"],
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
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    // Move Activity up (the network column is keeping-up, activity, composition)
    const moveUpBtn = screen.getByRole("button", { name: "Move Activity up" });
    fireEvent.click(moveUpBtn);

    expect(mockSetPreference).toHaveBeenCalledWith(
      "pulseLayout",
      expect.objectContaining({
        order: expect.objectContaining({
          network: ["activity", "keeping-up", "composition"],
        }),
      }),
    );
  });
});
