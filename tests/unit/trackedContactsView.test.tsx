// @vitest-environment jsdom
// =============================================================================
// The Tracked contacts page
// =============================================================================
// One page groups everyone by their ring state, At risk to Not tracked, with
// a toggle on every row and a bar for many at once. The groups, their ids
// (the Keeping up card links to them), the row's words, the order switch,
// select mode with the cadence menu, and the empty state are pinned here.
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
import { MemoryRouter } from "react-router-dom";
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
vi.mock("../../src/api/client", () => ({
  apiFetch: (...args: unknown[]) => api.fetch(...args),
}));
vi.mock("../../src/api", () => ({
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
} from "../../src/views/TrackedContactsView";
import type { Contact } from "../../src/types";

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
  JSON.parse((api.fetch.mock.calls.at(-1)?.[1] as RequestInit).body as string);

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

  it("orders the tracked groups by the moment of tracking, and Not tracked by name", () => {
    const groups = groupContacts(PEOPLE, { order: "recent" });
    const strong = groups.find((g) => g.id === "strong")!;
    expect(strong.contacts.map((c) => c.id)).toEqual(["katherine", "ada"]);
    const untracked = groups.find((g) => g.id === "not-tracked")!;
    expect(untracked.contacts.map((c) => c.id)).toEqual(["linus", "margaret"]);
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
  it("has the heading, the sentence, and the five groups with their ids and counts", () => {
    mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Tracked contacts" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Track the people you want to keep up with/),
    ).toBeTruthy();
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

  it("links each name to the contact", () => {
    mount();
    expect(
      screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href"),
    ).toBe("/contact/ada");
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
      screen.getByRole("button", { name: "Untrack Ada Lovelace" }),
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

  it("narrows by the search box and offers to clear it when nobody matches", () => {
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
      screen.getByRole("heading", { name: 'Nobody matches "zzz"' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(heading(/^At risk/)).toBeTruthy();
  });

  it("selects a whole group, and the bar tracks, untracks and sets one cadence", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(bar.textContent).toContain("0 selected");

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

    // Untrack sends only the tracked ones: none of these are.
    fireEvent.click(within(bar).getByRole("button", { name: "Untrack" }));
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

  it("waits with all three bar buttons while nobody is picked", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    for (const name of ["Track", "Untrack", "Cadence"]) {
      expect(
        (within(bar).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Linus Torvalds" }),
    );
    for (const name of ["Track", "Untrack", "Cadence"]) {
      expect(
        (within(bar).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    }
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
    const scroller = screen
      .getByRole("heading", { level: 1 })
      .closest(".overflow-y-auto") as HTMLElement;
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
      screen.getByRole("heading", { level: 2, name: "Nobody is tracked yet" }),
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
