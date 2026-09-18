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
import {
  ActivityCardStopgap,
  MomentumCardStopgap,
  CompositionCardStopgap,
} from "../../src/views/pulse/cards/NetworkStopgapCards";
import type { DashboardPayload } from "../../src/api";

vi.mock("../../src/views/dedupe/components", () => ({
  SuggestionReviewQueue: () => (
    <div data-testid="suggestion-review-queue">Mock Dedupe Queue</div>
  ),
}));

vi.mock("../../src/views/pulse/NetworkGrowthModal", () => ({
  NetworkGrowthModal: () => <div data-testid="growth-modal" />,
}));
vi.mock("../../src/views/pulse/InteractionVelocityModal", () => ({
  InteractionVelocityModal: () => <div data-testid="velocity-modal" />,
}));
vi.mock("../../src/views/pulse/NetworkCompositionModal", () => ({
  NetworkCompositionModal: () => <div data-testid="composition-modal" />,
}));

const mockCompleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
let mockDashboardData: DashboardPayload | null = null;
let mockMomentumData: {
  snapshotWeeks: number;
  rising: unknown[];
  cooling: unknown[];
  silent: unknown[];
} = {
  snapshotWeeks: 0,
  rising: [],
  cooling: [],
  silent: [],
};
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
  useDashboardMomentum: () => ({
    data: mockMomentumData,
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
    setPreference: vi.fn(),
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
      avgDaysSinceInteraction: 12,
      atRiskCount: 1,
      totalInteractions30d: 15,
      newContacts30d: 4,
    },
    atRisk: [
      {
        id: "c-3",
        name: "Alan Turing",
        company: "Bletchley",
        avatarUrl: null,
        themeColor: "#8b5cf6",
        relationshipScore: 35,
        daysSinceContact: 40,
        lastInteractionTitle: "Quarterly review",
      },
    ],
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
    mockDashboardData = createSampleDashboard();
    mockMomentumData = {
      snapshotWeeks: 0,
      rising: [],
      cooling: [],
      silent: [],
    };
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
      "activity",
      "momentum",
      "composition",
    ];
    const renderedCardIds = Array.from(cards).map((el) =>
      el.getAttribute("data-card-id"),
    );
    expect(renderedCardIds.sort()).toEqual(expectedCardIds.sort());
  });

  it("ensures a hidden card from the preference is absent", () => {
    mockPreferences = {
      pulseLayout: { hidden: ["momentum"], order: {} },
      singleKeyShortcuts: true,
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    const cards = container.querySelectorAll("[data-card-id]");
    expect(cards.length).toBe(8);
    expect(container.querySelector('[data-card-id="momentum"]')).toBeNull();
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

  it("shows the four-week message on Momentum card when snapshotWeeks < 4", () => {
    mockMomentumData = {
      snapshotWeeks: 2,
      rising: [],
      cooling: [],
      silent: [],
    };

    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Momentum needs four weeks of history."),
    ).toBeDefined();
  });

  it("renders WelcomeOffice when totalActive is zero", () => {
    mockDashboardData = createSampleDashboard({
      metrics: {
        totalActive: 0,
        avgDaysSinceInteraction: 0,
        atRiskCount: 0,
        totalInteractions30d: 0,
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
      relationshipScore: null,
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

  it("renders stopgap cards and opens modals on metric click", async () => {
    const dummyDashboard = {
      metrics: {
        totalInteractions30d: 42,
        totalActive: 100,
        newContacts30d: 5,
      },
      interactionBreakdown30d: [],
      networkGrowthTimeline30d: [],
    } as unknown as DashboardPayload;
    const { unmount: unmount1 } = render(
      <ActivityCardStopgap dashboard={dummyDashboard} />,
    );
    expect(screen.getByText("Interactions")).toBeDefined();
    fireEvent.click(screen.getByText("Interactions"));
    expect(await screen.findByTestId("velocity-modal")).toBeDefined();
    unmount1();

    const { unmount: unmount2 } = render(
      <MomentumCardStopgap dashboard={dummyDashboard} />,
    );
    expect(screen.getByText("Active Network")).toBeDefined();
    fireEvent.click(screen.getByText("Active Network"));
    expect(await screen.findByTestId("composition-modal")).toBeDefined();
    unmount2();

    const { unmount: unmount3 } = render(
      <CompositionCardStopgap dashboard={dummyDashboard} />,
    );
    expect(screen.getByText("Network Growth")).toBeDefined();
    fireEvent.click(screen.getByText("Network Growth"));
    expect(await screen.findByTestId("growth-modal")).toBeDefined();
    unmount3();
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
});
