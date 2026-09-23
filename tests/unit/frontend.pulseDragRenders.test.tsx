// @vitest-environment jsdom
// =============================================================================
// A drag renders the grid, not the cards
// =============================================================================
// Each step of a customize drag changes the grid's draft. The page builds
// each card's element once per change of the card's data (`PulseView`), and
// the grid passes those elements to its memoised cards, so a step renders
// the grid and React skips the queue, the heatmap and the charts. Here each
// card is a stand-in that counts its renders and draws the real card frame,
// grip and all, so the keyboard can carry a card while the counts are read.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PulseView } from "../../src/views/pulse/PulseView";

/**
 * The render counts, and a card that counts its renders and draws the frame
 * the real one draws. Hoisted: `vi.mock` runs before the file's own lines.
 */
const { renders, standIn } = vi.hoisted(() => {
  const renders: Record<string, number> = {};
  const standIn = async (cardId: string, title: string) => {
    const { CardFrame } =
      await import("../../src/views/pulse/components/CardFrame");
    return function CountingCard() {
      renders[cardId] = (renders[cardId] ?? 0) + 1;
      return (
        <CardFrame cardId={cardId} title={title}>
          <p>{title} body</p>
        </CardFrame>
      );
    };
  };
  return { renders, standIn };
});

vi.mock("../../src/views/pulse/cards/UpNextCard", async () => ({
  UpNextCard: await standIn("up-next", "Up next"),
}));
vi.mock("../../src/views/pulse/cards/CompletedCard", async () => ({
  CompletedCard: await standIn("completed", "Completed"),
}));
vi.mock("../../src/views/pulse/cards/ActivityCard", async () => ({
  ActivityCard: await standIn("activity", "Activity"),
}));
vi.mock("../../src/views/pulse/cards/KeepingUpCard", async () => ({
  KeepingUpCard: await standIn("keeping-up", "Keeping up"),
}));
vi.mock("../../src/views/pulse/cards/CompositionCard", async () => ({
  CompositionCard: await standIn("composition", "Composition"),
}));
vi.mock("../../src/views/pulse/cards/InsightCard", async () => ({
  InsightCard: await standIn("insight", "Daily insight"),
}));
vi.mock("../../src/views/pulse/cards/InboxCard", async () => ({
  InboxCard: await standIn("inbox", "Inbox"),
}));
vi.mock("../../src/views/pulse/cards/ComingUpCard", async () => ({
  ComingUpCard: await standIn("coming-up", "Coming up"),
}));

const mockSetPreference = vi.fn();
const DASHBOARD = {
  overdue: [],
  dueToday: [],
  upcoming: [],
  ghosts: [],
  catchUp: [],
  meetings: [],
  correspondents: 0,
  metrics: { totalActive: 12, newContacts30d: 0 },
  tracking: {
    count: 0,
    bands: { strong: 0, fading: 0, atRisk: 0, unscored: 0 },
    catchUpCount: 0,
    startedLast30d: 0,
    snapshotWeeks: 0,
    rising: [],
    cooling: [],
  },
  hygiene: { missingCompany: 0, missingLocation: 0, missingEmail: 0, stale: 0 },
};
const ACTIVITY = {
  days: [],
  weekTotals: [],
  prevWeekTotals: [],
  streak: { current: 0, best: 0, lastDay: null },
  today: { logged: 0, completed: 0, due: 0 },
  thisWeek: { logged: 0, byType: {} },
};
const CONTACTS: unknown[] = [];
const MUTATION = { mutate: vi.fn(), isPending: false };
const PREFERENCES = {
  pulseLayout: { hidden: [], order: {} },
  singleKeyShortcuts: true,
};

vi.mock("../../src/api", () => ({
  useDashboard: () => ({ data: DASHBOARD, isLoading: false, isError: false }),
  useDailyInsight: () => ({ data: null, isLoading: false }),
  useDashboardActivity: () => ({ data: ACTIVITY }),
  useContacts: () => ({ data: CONTACTS }),
  useCompleteActionItem: () => MUTATION,
  useUpdateActionItem: () => MUTATION,
  useDedupeCount: () => ({ data: { count: 0 } }),
}));
vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: PREFERENCES,
    setPreference: mockSetPreference,
  }),
}));
vi.mock("../../src/hooks/useSingleKeyShortcuts", () => ({
  useSingleKeyShortcuts: () => true,
}));
vi.mock("../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => false,
}));

/** Let dnd-kit's keyboard sensor arm its key listener, which waits a tick. */
const tick = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("a customize drag and the cards' renders", () => {
  beforeEach(() => {
    for (const key of Object.keys(renders)) delete renders[key];
    mockSetPreference.mockClear();
  });
  afterEach(() => cleanup());

  it("renders no card again for customize mode or for a step of the drag", async () => {
    render(
      <MemoryRouter initialEntries={["/pulse"]}>
        <PulseView />
      </MemoryRouter>,
    );
    const atLoad = { ...renders };
    expect(Object.keys(atLoad).sort()).toEqual(
      [
        "activity",
        "coming-up",
        "completed",
        "composition",
        "inbox",
        "insight",
        "keeping-up",
        "up-next",
      ].sort(),
    );

    // Customize mode: the frames show their controls through the context,
    // and the cards themselves are not rendered again.
    fireEvent.keyDown(window, { key: "c", code: "KeyC" });
    expect(screen.getByText("Editing layout")).toBeDefined();
    expect(renders).toEqual(atLoad);

    // Pick Keeping up up and carry it two places.
    const grip = screen.getByRole("button", {
      name: "Drag Keeping up to reorder",
    });
    grip.focus();
    fireEvent.keyDown(grip, { code: "Space", key: " " });
    await tick();
    fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    await tick();
    fireEvent.keyDown(document, { code: "ArrowUp", key: "ArrowUp" });
    await tick();
    fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    await tick();
    // Every other card has rendered as often as it did at load. Keeping up
    // folded to its slot, so it has not rendered either.
    expect(renders).toEqual(atLoad);

    // The drop saves once, and only the card that moved renders again, as
    // it unfolds in its new place.
    fireEvent.keyDown(document, { code: "Space", key: " " });
    await tick();
    expect(mockSetPreference).toHaveBeenCalledTimes(1);
    const { "keeping-up": movedCard, ...others } = renders;
    const { "keeping-up": movedAtLoad, ...othersAtLoad } = atLoad;
    expect(others).toEqual(othersAtLoad);
    expect(movedCard).toBe(movedAtLoad + 1);
  });
});
