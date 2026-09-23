// @vitest-environment jsdom
// =============================================================================
// A contact list row says the score in its name
// =============================================================================
// The ring's colour carried the score and nothing else did, so a screen reader
// user and anyone who cannot tell the colours apart got nothing from it. The
// row's link now names the person, the line under the name, and the score in
// words: "Betty Clark, Global Dynamics, score 72, strong". The ring is then
// decorative, so the score is said once, and its tooltip stays for a pointer.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ContactListItem } from "../../src/views/contact-list/ContactListItem";
import { BulkActionToolbar } from "../../src/views/contact-list/BulkActionToolbar";
import { formatDay } from "../../src/lib/datetime";
import type { Contact } from "../../src/types";

afterEach(() => {
  cleanup();
});

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    name: "Betty Clark",
    firstName: "Betty",
    lastName: "Clark",
    headline: null,
    role: "Designer",
    company: "Global Dynamics",
    location: "Portland, OR",
    birthday: null,
    preferences: null,
    avatarUrl: null,
    isGhost: false,
    isArchived: false,
    isTracked: true,
    trackedAt: "2026-01-01T00:00:00.000Z",
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cadenceDays: 30,
    lastContactedAt: "2026-09-10 05:33:50",
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
    relationshipScore: 72,
    ...overrides,
  };
}

function mount(
  contact: Contact,
  state: {
    active?: boolean;
    isSelectMode?: boolean;
    isSelected?: boolean;
    showSelection?: boolean;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContactListItem
          contact={contact}
          density="comfortable"
          active={state.active ?? false}
          isSelectMode={state.isSelectMode ?? false}
          isSelected={state.isSelected ?? false}
          showSelection={state.showSelection}
          onToggleSelect={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole("link");
}

describe("the row's accessible name", () => {
  it("carries the name, the company and the score in words", () => {
    const row = mount(makeContact());
    expect(
      screen.getByRole("link", {
        name: "Betty Clark, Global Dynamics, score 72, strong",
      }),
    ).toBe(row);
    // The browser e2e specs find a row by its id and by a name that starts
    // with the person's name. Both still hold.
    expect(row.id).toBe("contact-row-c1");
    expect(screen.getByRole("link", { name: /^Betty Clark/ })).toBe(row);
  });

  it("uses the role when there is no company", () => {
    const row = mount(makeContact({ company: null, relationshipScore: 55 }));
    expect(row.getAttribute("aria-label")).toBe(
      "Betty Clark, Designer, score 55, fading",
    );
  });

  it("leaves out the middle part when there is no company or role", () => {
    const row = mount(
      makeContact({ company: null, role: null, relationshipScore: 12 }),
    );
    expect(row.getAttribute("aria-label")).toBe(
      "Betty Clark, score 12, at risk",
    );
  });

  it("says no interactions yet when there is no last contact", () => {
    // The stored 50 is the column's default, not a score.
    const row = mount(
      makeContact({ lastContactedAt: null, relationshipScore: 50 }),
    );
    expect(row.getAttribute("aria-label")).toBe(
      "Betty Clark, Global Dynamics, no interactions yet",
    );
  });

  it("says nothing about the score for a contact nobody tracks", () => {
    // The column still holds 72. Nobody asked to keep up with this person,
    // so the row says who they are and stops there.
    const row = mount(makeContact({ isTracked: false }));
    expect(row.getAttribute("aria-label")).toBe("Betty Clark, Global Dynamics");
  });
});

describe("the ring in the row", () => {
  it("is hidden, so the score is said once, and keeps its tooltip", () => {
    const row = mount(makeContact());
    // No named image inside the link: the link's own name says the score.
    expect(within(row).queryByRole("img", { name: /score/i })).toBeNull();
    const ring = row.querySelector("[data-score-band]")!;
    expect(ring.getAttribute("data-score-band")).toBe("strong");
    const tooltip = ring.closest("[title]")!;
    expect(tooltip.getAttribute("title")).toBe("Score 72, strong");
    expect(tooltip.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives the tooltip the no-score words too", () => {
    const row = mount(makeContact({ lastContactedAt: null }));
    const ring = row.querySelector("[data-score-band]")!;
    expect(ring.getAttribute("data-score-band")).toBe("unscored");
    expect(ring.closest("[title]")!.getAttribute("title")).toBe(
      "No interactions yet",
    );
  });

  it("is a picture with no ring and no tooltip when nobody tracks the contact", () => {
    const row = mount(makeContact({ isTracked: false }));
    const ring = row.querySelector("[data-score-band]")!;
    expect(ring.getAttribute("data-score-band")).toBe("untracked");
    expect(ring.querySelector("svg")).toBeNull();
    expect(ring.closest("[title]")).toBeNull();
  });
});

describe("the selected look", () => {
  // One look for a selected row: the tint (`row-selected`), and the name in
  // the ink that reads on the tint. The open contact wore a ring and a
  // picked row an outline, and both read as keyboard focus.
  const name = (row: HTMLElement) => within(row).getByText("Betty Clark");

  it("marks the open contact with the tint", () => {
    const row = mount(makeContact(), { active: true });
    expect(row.classList.contains("row-selected")).toBe(true);
    expect(row.className).not.toMatch(/\b(ring|outline)-/);
    expect(name(row).classList.contains("text-on-primary-wash")).toBe(true);
  });

  it("marks a row picked in select mode the same way", () => {
    const row = mount(makeContact(), { isSelectMode: true, isSelected: true });
    expect(row.classList.contains("row-selected")).toBe(true);
    expect(row.className).not.toMatch(/\b(ring|outline)-/);
    expect(name(row).classList.contains("text-on-primary-wash")).toBe(true);
  });

  it("leaves the open contact unmarked in select mode until it is picked", () => {
    const row = mount(makeContact(), { active: true, isSelectMode: true });
    expect(row.classList.contains("row-selected")).toBe(false);
    expect(name(row).classList.contains("text-on-surface")).toBe(true);
  });

  // The Recent strip repeats a person who is also a row in the list under
  // it, and the open contact looked selected twice. The copy is current for
  // a screen reader and shows its checkbox, and never takes the tint.
  it("keeps the Recent copy of the open contact current, with no tint", () => {
    const row = mount(makeContact(), { active: true, showSelection: false });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.classList.contains("row-selected")).toBe(false);
    expect(name(row).classList.contains("text-on-surface")).toBe(true);
  });

  it("keeps the Recent copy of a picked row checked, with no tint", () => {
    const row = mount(makeContact(), {
      isSelectMode: true,
      isSelected: true,
      showSelection: false,
    });
    expect(row.classList.contains("row-selected")).toBe(false);
    expect(row.querySelector(".bg-primary")).not.toBeNull();
  });
});

describe("the follow-up glyph", () => {
  // The calendar glyph said nothing, and it was red for today where Pulse
  // uses the primary. It takes the due chip's tones and says the fact.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the follow-up in its tooltip, in the tone of how late it is", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 0));
    const glyph = (day: number) => {
      cleanup();
      const row = mount(
        makeContact({
          nextFollowUpAt: new Date(2026, 8, day, 9, 0).toISOString(),
        }),
      );
      const tip = row.querySelector('[title^="Follow-up"]')!;
      return {
        title: tip.getAttribute("title"),
        svg: tip.querySelector("svg")!,
      };
    };
    const late = glyph(19);
    expect(late.title).toBe("Follow-up 3 days overdue");
    expect(late.svg.classList.contains("text-error")).toBe(true);
    const today = glyph(22);
    expect(today.title).toBe("Follow-up due today");
    expect(today.svg.classList.contains("text-primary")).toBe(true);
    const later = glyph(23);
    expect(later.title).toBe("Follow-up due tomorrow");
    expect(later.svg.classList.contains("text-on-surface-variant")).toBe(true);
  });

  it("draws no glyph with no follow-up", () => {
    const row = mount(makeContact());
    expect(row.querySelector('[title^="Follow-up"]')).toBeNull();
  });

  // The glyph's colour and its tooltip were the only signs of it. The
  // row's name closes with the same words.
  it("closes the row's name with the follow-up", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 0));
    const row = mount(makeContact({ nextFollowUpAt: "2026-09-19" }));
    expect(row.getAttribute("aria-label")).toMatch(
      /, follow-up 3 days overdue$/,
    );
  });

  // Between 768 and 1023 px the glyph sat at the end of the name's line,
  // and moved with the width of the city in the column beside it. It has a
  // slot of its own in that column, on every row, empty with no follow-up.
  it("keeps a slot of one width for the glyph in the tablet column", () => {
    const slotOf = (row: HTMLElement) =>
      row.querySelector(".md\\:flex.lg\\:hidden > span.w-3\\.5");
    const late = mount(makeContact({ nextFollowUpAt: "2026-09-19" }));
    expect(slotOf(late)?.querySelector("svg")).not.toBeNull();
    // The one on the name's line hides at that width.
    expect(
      late
        .querySelector('[title^="Follow-up"]')!
        .classList.contains("md:hidden"),
    ).toBe(true);
    cleanup();
    const none = mount(makeContact());
    expect(slotOf(none)).not.toBeNull();
    expect(slotOf(none)?.querySelector("svg")).toBeNull();
  });
});

describe("the bulk bar", () => {
  // Select mode kept "Network" as the page's title. The count moved to the
  // start of the bar, and is read out as it changes.
  const noop = () => {};
  const bar = (selectedCount?: number) =>
    render(
      <BulkActionToolbar
        selectedCount={selectedCount}
        isPending={false}
        onTrack={noop}
        selectionTracked="none"
        onArchive={noop}
        onAddToList={noop}
        onEditField={noop}
        onColorChange={noop}
        onExportCSV={noop}
        onDelete={noop}
      />,
    );

  it("leads with the count, in a polite live region", () => {
    bar(3);
    const toolbar = screen.getByRole("toolbar", { name: "Bulk actions" });
    const count = within(toolbar).getByText(
      (_, el) => el?.textContent === "3 selected" && el.tagName === "SPAN",
    );
    expect(count.getAttribute("aria-live")).toBe("polite");
    // Atomic, so NVDA says "3 selected" and not the changed "3" alone.
    expect(count.getAttribute("role")).toBe("status");
    expect(count.getAttribute("aria-atomic")).toBe("true");
    expect(toolbar.firstElementChild).toBe(count);
    // Track is still the first button.
    expect(within(toolbar).getAllByRole("button")[0]).toBe(
      within(toolbar).getByRole("button", { name: "Track" }),
    );
  });

  it("says no count where the page gives none, as the map does", () => {
    bar();
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});

describe("the last contacted date", () => {
  it("reads a SQLite timestamp as UTC and prints the medium date", () => {
    const row = mount(makeContact({ lastContactedAt: "2026-09-10 05:33:50" }));
    const stamp = row.querySelector('[title^="Last contacted"]')!;
    expect(stamp.getAttribute("title")).toBe(
      `Last contacted ${formatDay("2026-09-10T05:33:50Z")}`,
    );
  });
});
