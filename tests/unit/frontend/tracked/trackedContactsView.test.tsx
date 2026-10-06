// @vitest-environment jsdom
// =============================================================================
// The Tracked contacts page
// =============================================================================
// One page groups everyone by their ring state, At risk to Not tracked, with
// a toggle on every row and a bar for many at once. The groups, their ids
// (the Keeping up card links to them), the row's words, the order switch,
// select mode with the cadence menu, and the empty state are pinned here,
// and so are the two rows of filters (tracking, and when you last spoke),
// which live in the page's address.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  contacts: [] as unknown[],
  bulkUpdate: vi.fn(),
}));
vi.mock("../../../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/client")>()),
  apiFetch: (...args: unknown[]) => api.fetch(...args),
  // A hook names its route's contract: the request reaches `api.fetch` with
  // the contract's method, as it reaches the server.
  apiJson: async (
    route: { method: string },
    path: string,
    init?: RequestInit,
  ) => (await api.fetch(path, { ...init, method: route.method })).json(),
}));
vi.mock("../../../../src/api", () => ({
  useContacts: () => ({ data: api.contacts, isLoading: false }),
  useBulkDeleteContacts: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkRestoreContacts: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateContacts: () => ({ mutate: api.bulkUpdate, isPending: false }),
  useBulkAddToList: () => ({ mutate: vi.fn(), isPending: false }),
}));

import {
  TrackedContactsView,
  groupContacts,
  pastDue,
} from "../../../../src/views/TrackedContactsView";
import type { Contact } from "../../../../src/types";

const DAY = 86_400_000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString();

function person(
  overrides: Partial<Contact> & { id: string; name: string },
): Contact {
  return {
    firstName: null,
    lastName: null,
    headline: null,
    role: null,
    company: null,
    location: null,
    birthday: null,
    preferences: null,
    avatarUrl: null,
    isGhost: false,
    isArchived: false,
    isTracked: false,
    trackedAt: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cadenceDays: 90,
    lastContactedAt: null,
    nextFollowUpAt: null,
    themeColor: "brand",
    about: null,
    pronouns: null,
    industry: null,
    website: null,
    lat: null,
    lng: null,
    emails: [],
    phones: [],
    socialLinks: [],
    education: [],
    experience: [],
    sources: [],
    tags: [],
    lists: [],
    addresses: [],
    interests: [],
    attributes: [],
    aiBriefing: null,
    aiBackground: null,
    aiSummary: null,
    aiHydratedAt: null,
    aiBriefingAt: null,
    aiResearch: null,
    searchExpansion: null,
    deletedAt: null,
    canonicalId: null,
    phoneticHash: null,
    geoSource: null,
    ownerId: "owner-1",
    scoreDirty: 0,
    interactionCount: 0,
    relationshipScore: 50,
    ...overrides,
  };
}

/** One person in every group, and a second in two of them. */
const PEOPLE: Contact[] = [
  person({
    id: "edsger",
    name: "Edsger Dijkstra",
    company: "UT Austin",
    isTracked: true,
    trackedAt: daysAgo(400),
    cadenceDays: 30,
    lastContactedAt: daysAgo(51),
    relationshipScore: 20,
  }),
  person({
    id: "grace",
    name: "Grace Hopper",
    company: "US Navy",
    isTracked: true,
    trackedAt: daysAgo(10),
    lastContactedAt: daysAgo(20),
    relationshipScore: 55,
  }),
  person({
    id: "ada",
    name: "Ada Lovelace",
    company: "Babbage & Co",
    role: "Analytical Engineer",
    isTracked: true,
    trackedAt: daysAgo(30),
    lastContactedAt: daysAgo(3),
    relationshipScore: 80,
  }),
  person({
    id: "katherine",
    name: "Katherine Johnson",
    company: "NASA",
    isTracked: true,
    trackedAt: daysAgo(2),
    lastContactedAt: daysAgo(5),
    relationshipScore: 90,
  }),
  person({
    id: "zed",
    name: "Zed New",
    isTracked: true,
    trackedAt: daysAgo(1),
    cadenceDays: 60,
  }),
  person({
    id: "margaret",
    name: "Margaret Hamilton",
    company: "Hamilton Technologies",
  }),
  person({ id: "linus", name: "Linus Torvalds", company: "Linux Foundation" }),
];

function mount(path = "/tracked") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TrackedContactsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const heading = (name: RegExp) =>
  screen.getByRole("heading", { level: 2, name });
const section = (name: RegExp) =>
  heading(name).closest("section") as HTMLElement;
const namesIn = (name: RegExp) =>
  within(section(name))
    .getAllByRole("link")
    .map((link) => link.textContent);

/** The body of the last PATCH the page sent. */
const lastBody = () =>
  JSON.parse((api.fetch.mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => {
  api.contacts = PEOPLE;
  api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
    json: async () => ({ ...PEOPLE[0], ...JSON.parse(init.body as string) }),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("groupContacts", () => {
  it("puts everyone in one of five groups, in order, by the ring state", () => {
    const groups = groupContacts(PEOPLE);
    expect(groups.map((g) => [g.id, g.contacts.map((c) => c.id)])).toEqual([
      ["at-risk", ["edsger"]],
      ["fading", ["grace"]],
      ["strong", ["ada", "katherine"]],
      ["unscored", ["zed"]],
      ["not-tracked", ["linus", "margaret"]],
    ]);
  });

  it("narrows every group by name, company or role, and drops the empty ones", () => {
    expect(groupContacts(PEOPLE, { query: "nasa" }).map((g) => g.id)).toEqual([
      "strong",
    ]);
    expect(
      groupContacts(PEOPLE, { query: "analytical" })[0].contacts[0].id,
    ).toBe("ada");
    expect(
      groupContacts(PEOPLE, { query: "torvalds" }).map((g) => g.id),
    ).toEqual(["not-tracked"]);
  });

  it("leaves out archived contacts and ghosts", () => {
    const groups = groupContacts([
      ...PEOPLE,
      person({ id: "gone", name: "Gone", isTracked: true, isArchived: true }),
      person({ id: "ghost", name: "Ghost", isGhost: true }),
    ]);
    const ids = groups.flatMap((g) => g.contacts.map((c) => c.id));
    expect(ids).not.toContain("gone");
    expect(ids).not.toContain("ghost");
  });
});

describe("pastDue", () => {
  it("counts from the last interaction, or from the moment of tracking", () => {
    expect(pastDue(PEOPLE[0])).toBe("3 weeks past due");
    expect(pastDue(PEOPLE[2])).toBeNull();
    expect(
      pastDue({
        isTracked: true,
        cadenceDays: 30,
        lastContactedAt: null,
        trackedAt: daysAgo(31),
      }),
    ).toBe("1 day past due");
    expect(
      pastDue({
        isTracked: false,
        cadenceDays: 30,
        lastContactedAt: daysAgo(400),
        trackedAt: null,
      }),
    ).toBeNull();
  });
});

describe("the Tracked contacts page", () => {
  // The heading and its sentence are the Settings shell's, as on every
  // settings page. The page draws the groups under them.
  it("has the five groups with their ids and counts", () => {
    mount();
    for (const [id, name, count] of [
      ["at-risk", /^At risk/, "1"],
      ["fading", /^Fading/, "1"],
      ["strong", /^Strong/, "2"],
      ["unscored", /^No interactions yet/, "1"],
      ["not-tracked", /^Not tracked/, "2"],
    ] as const) {
      const h2 = heading(name);
      expect(h2.id).toBe(id);
      expect(h2.textContent).toContain(count);
    }
    expect(namesIn(/^Strong/)).toEqual(["Ada Lovelace", "Katherine Johnson"]);
    expect(namesIn(/^Not tracked/)).toEqual([
      "Linus Torvalds",
      "Margaret Hamilton",
    ]);
  });

  it("says the cadence and how far past due a tracked row is, and nothing of the kind for an untracked one", () => {
    mount();
    const edsger = screen
      .getByText("Edsger Dijkstra")
      .closest("[data-contact-id]")!;
    expect(edsger.textContent).toContain("monthly");
    expect(edsger.textContent).toContain("3 weeks past due");
    const ada = screen.getByText("Ada Lovelace").closest("[data-contact-id]")!;
    expect(ada.textContent).toContain("quarterly");
    expect(ada.textContent).not.toContain("past due");
    const linus = screen
      .getByText("Linus Torvalds")
      .closest("[data-contact-id]")!;
    // No cadence at all for a contact nobody tracks: its stored 90 days
    // were never chosen for it.
    expect(linus.textContent).not.toMatch(/quarterly|monthly|every/);
  });

  it("tracks and untracks from the row toggle, with the toast", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Track Linus Torvalds" }),
    );
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));
    expect(api.fetch.mock.calls[0][0]).toBe("/contacts/linus");
    expect(lastBody()).toEqual({ isTracked: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Stop tracking Ada Lovelace" }),
    );
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(api.fetch.mock.calls[1][0]).toBe("/contacts/ada");
    expect(lastBody()).toEqual({ isTracked: false });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2));
  });

  it("switches the order to Recently tracked", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Recently tracked" }));
    expect(namesIn(/^Strong/)).toEqual(["Katherine Johnson", "Ada Lovelace"]);
    expect(namesIn(/^Not tracked/)).toEqual([
      "Linus Torvalds",
      "Margaret Hamilton",
    ]);
  });

  it("narrows by the search box and offers to clear it when no one matches", () => {
    mount();
    const box = screen.getByRole("searchbox", {
      name: "Search tracked contacts",
    });
    fireEvent.change(box, { target: { value: "nasa" } });
    expect(
      screen.queryByRole("heading", { level: 2, name: /^At risk/ }),
    ).toBeNull();
    expect(namesIn(/^Strong/)).toEqual(["Katherine Johnson"]);

    fireEvent.change(box, { target: { value: "zzz" } });
    expect(
      screen.getByRole("heading", { name: 'No one matches "zzz"' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(heading(/^At risk/)).toBeTruthy();
  });

  it("selects a whole group, and the bar tracks, stops tracking and sets one cadence", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(bar.textContent).toContain("0 selected");
    // The three buttons wait while no one is picked.
    for (const name of ["Track", "Stop tracking", "Cadence"]) {
      expect(
        (within(bar).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }

    fireEvent.click(
      within(section(/^Not tracked/)).getByRole("button", {
        name: "Select all",
      }),
    );
    expect(bar.textContent).toContain("2 selected");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select Linus Torvalds",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(within(bar).getByRole("button", { name: "Track" }));
    expect(api.bulkUpdate).toHaveBeenLastCalledWith(
      { ids: ["linus", "margaret"], data: { isTracked: true } },
      expect.anything(),
    );

    // Stop tracking sends only the tracked ones: none of these are.
    fireEvent.click(within(bar).getByRole("button", { name: "Stop tracking" }));
    expect(api.bulkUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(within(bar).getByRole("button", { name: "Cadence" }));
    // The four cadences, one word each.
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Weekly", "Monthly", "Quarterly", "Yearly"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Monthly" }));
    expect(api.bulkUpdate).toHaveBeenLastCalledWith(
      { ids: ["linus", "margaret"], data: { cadenceDays: 30 } },
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // The bar leaves through its exit animation.
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Track Linus Torvalds" }),
    ).toBeTruthy();
  });

  it("keeps the bar in the page's column, and focus on the swapped button", () => {
    mount();
    const select = screen.getByRole("button", { name: "Select" });
    select.focus();
    fireEvent.click(select);
    // Select turned into Done: focus went with it rather than to the body.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Done" }),
    );
    // In the column with the cards, stuck to the bottom of the scroller, and
    // no longer fixed to the window, where it covered the rail.
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    const box = bar.parentElement!;
    expect(box.className).toContain("sticky");
    expect(box.className).not.toContain("fixed");
    expect(box.parentElement).toBe(
      section(/^At risk/).parentElement!.parentElement,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select" }),
    );
  });

  it("keeps the bar's room as scroll padding while it shows, so Tab stops above it", async () => {
    mount();
    const scroller = heading(/^At risk/).closest(
      ".overflow-y-auto",
    ) as HTMLElement;
    expect(scroller.style.scrollPaddingBottom).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(scroller.style.scrollPaddingBottom).toMatch(/px$/);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(scroller.style.scrollPaddingBottom).toBe(""));
  });

  it("says nobody is tracked yet, and keeps the Not tracked group as the way in", () => {
    api.contacts = PEOPLE.filter((p) => !p.isTracked);
    mount();
    expect(
      screen.getByRole("heading", { level: 2, name: "No one is tracked yet" }),
    ).toBeTruthy();
    expect(namesIn(/^Not tracked/)).toEqual([
      "Linus Torvalds",
      "Margaret Hamilton",
    ]);
    expect(
      screen.queryByRole("heading", { level: 2, name: /^Strong/ }),
    ).toBeNull();
  });
});

// ─── The filters ────────────────────────────────────────────────────────────

/** Two more people nobody tracks: one met ten days ago, one 500 days ago. */
const WITH_TALKS: Contact[] = [
  ...PEOPLE,
  person({
    id: "barbara",
    name: "Barbara Liskov",
    company: "MIT",
    lastContactedAt: daysAgo(10),
  }),
  person({ id: "alan", name: "Alan Kay", lastContactedAt: daysAgo(500) }),
];

/** Shows the page's address, so a test can read what the filters wrote. */
const Where = () => {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
};

/** The contact page's stand-in: what the row's link handed it. */
const ContactProbe = () => {
  const state = useLocation().state as {
    back?: { to: string; label: string };
  } | null;
  return (
    <p data-testid="back">
      {state?.back?.to} | {state?.back?.label}
    </p>
  );
};

function mountRoutes(path = "/tracked") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/tracked"
            element={
              <>
                <TrackedContactsView />
                <Where />
              </>
            }
          />
          <Route path="/contact/:id" element={<ContactProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A row of pills by its label, and each pill's words. */
const pills = (row: string) =>
  within(screen.getByRole("group", { name: row }))
    .getAllByRole("button")
    .map((pill) => pill.textContent);
const pill = (row: string, name: RegExp) =>
  within(screen.getByRole("group", { name: row })).getByRole("button", {
    name,
  });
const where = () => screen.getByTestId("where").textContent;

describe("groupContacts, with the filters", () => {
  it("narrows by tracking and by the last interaction", () => {
    const now = Date.now();
    const notTrackedThisMonth = groupContacts(WITH_TALKS, {
      tracking: "not_tracked",
      spoke: "month",
      now,
    });
    expect(
      notTrackedThisMonth.map((g) => [g.id, g.contacts.map((c) => c.id)]),
    ).toEqual([["not-tracked", ["barbara"]]]);
    const trackedNever = groupContacts(WITH_TALKS, {
      tracking: "tracked",
      spoke: "never",
      now,
    });
    expect(
      trackedNever.map((g) => [g.id, g.contacts.map((c) => c.id)]),
    ).toEqual([["unscored", ["zed"]]]);
  });
});

describe("the Tracked contacts page's filters", () => {
  beforeEach(() => {
    api.contacts = WITH_TALKS;
  });

  it("counts every pill beside the other row's choice", () => {
    mountRoutes();
    expect(pills("Tracking")).toEqual(["All9", "Tracked5", "Not tracked4"]);
    expect(pills("Last spoke")).toEqual([
      "Any9",
      "Past month4",
      "Past year5",
      "Over a year ago1",
      "Never3",
    ]);
    expect(pill("Tracking", /^All/).getAttribute("aria-pressed")).toBe("true");
    expect(pill("Last spoke", /^Any/).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("narrows the groups, writes the choices into the address, and recounts the other row", () => {
    mountRoutes();
    fireEvent.click(pill("Tracking", /^Not tracked/));
    expect(where()).toBe("?tracking=not_tracked");
    expect(
      screen.queryByRole("heading", { level: 2, name: /^Strong/ }),
    ).toBeNull();
    expect(namesIn(/^Not tracked/)).toEqual([
      "Alan Kay",
      "Barbara Liskov",
      "Linus Torvalds",
      "Margaret Hamilton",
    ]);
    expect(pills("Last spoke")).toEqual([
      "Any4",
      "Past month1",
      "Past year1",
      "Over a year ago1",
      "Never2",
    ]);

    fireEvent.click(pill("Last spoke", /^Past month/));
    expect(where()).toBe("?tracking=not_tracked&spoke=month");
    expect(namesIn(/^Not tracked/)).toEqual(["Barbara Liskov"]);
    expect(pills("Tracking")).toEqual(["All4", "Tracked3", "Not tracked1"]);
  });

  it("opens with the choices the address names", () => {
    mountRoutes("/tracked?tracking=tracked&spoke=year&order=spoke");
    expect(pill("Tracking", /^Tracked/).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen
        .getByRole("radio", { name: "Last spoke" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.queryByRole("heading", { level: 2, name: /^Not tracked/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { level: 2, name: /^No interactions/ }),
    ).toBeNull();
  });

  it("orders by Last spoke, and keeps the order in the address", () => {
    mountRoutes();
    fireEvent.click(screen.getByRole("radio", { name: "Last spoke" }));
    expect(where()).toBe("?order=spoke");
    expect(namesIn(/^Not tracked/)).toEqual([
      "Barbara Liskov",
      "Alan Kay",
      "Linus Torvalds",
      "Margaret Hamilton",
    ]);
  });

  it("says when you last spoke on a row that has an interaction, and nothing on one that has none", () => {
    mountRoutes();
    const ada = screen.getByText("Ada Lovelace").closest("[data-contact-id]")!;
    expect(ada.textContent).toContain("spoke 3 days ago");
    const barbara = screen
      .getByText("Barbara Liskov")
      .closest("[data-contact-id]")!;
    expect(barbara.textContent).toContain("spoke last week");
    const linus = screen
      .getByText("Linus Torvalds")
      .closest("[data-contact-id]")!;
    expect(linus.textContent).not.toContain("spoke");
  });

  it("says when the filters leave nobody, and clears them", () => {
    mountRoutes("/tracked?tracking=tracked&spoke=older");
    expect(
      screen.getByRole("heading", { name: "No one matches these filters" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(where()).toBe("");
    expect(heading(/^At risk/)).toBeTruthy();
  });

  it("offers the people to track when Tracked is chosen and nobody is", () => {
    api.contacts = WITH_TALKS.filter((p) => !p.isTracked);
    mountRoutes("/tracked?tracking=tracked");
    expect(
      screen.getByRole("heading", { level: 2, name: "No one is tracked yet" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "No one matches these filters" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show people to track" }),
    );
    expect(where()).toBe("?tracking=not_tracked");
    expect(namesIn(/^Not tracked/)).toHaveLength(4);
  });

  it("clears the selection when a filter changes, so the bar never acts on hidden people", () => {
    mountRoutes();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    fireEvent.click(
      within(section(/^Not tracked/)).getByRole("button", {
        name: "Select all",
      }),
    );
    expect(bar.textContent).toContain("4 selected");
    fireEvent.click(pill("Last spoke", /^Past month/));
    expect(bar.textContent).toContain("0 selected");
  });

  it("hands the contact page this list, filters included, for its Back", () => {
    mountRoutes("/tracked?order=spoke");
    fireEvent.click(screen.getByRole("link", { name: "Ada Lovelace" }));
    expect(screen.getByTestId("back").textContent).toBe(
      "/tracked?order=spoke | Tracked contacts",
    );
  });
});
