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

function mount(contact: Contact) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContactListItem
          contact={contact}
          density="comfortable"
          active={false}
          isSelectMode={false}
          isSelected={false}
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
    expect(ring.getAttribute("data-score-band")).toBe("none");
    expect(ring.closest("[title]")!.getAttribute("title")).toBe(
      "No interactions yet",
    );
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
