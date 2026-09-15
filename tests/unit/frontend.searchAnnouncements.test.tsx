// @vitest-environment jsdom
// =============================================================================
// Search announcements — what a screen reader hears, and when
// =============================================================================
// The wording is pure and tested as sentences. The region is tested for the
// two rules that make a live region reliable: it is in the DOM before it has
// anything to say, and the value it mounts with is not spoken.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import {
  noteSearchStatus,
  peopleSearchStatus,
  plural,
  type NoteSearchState,
  type PeopleSearchState,
} from "../../src/lib/searchAnnouncements";
import { LiveStatus } from "../../src/components/ui/LiveStatus";

afterEach(cleanup);

const people = (overrides: Partial<PeopleSearchState>): PeopleSearchState => ({
  isLoading: false,
  isEnriching: false,
  isError: false,
  hasSearched: false,
  count: 0,
  query: "who likes espresso",
  fallback: false,
  ...overrides,
});

const notes = (overrides: Partial<NoteSearchState>): NoteSearchState => ({
  isFetching: false,
  isSuccess: false,
  isError: false,
  hasSearch: true,
  total: 0,
  query: "hiring",
  ...overrides,
});

describe("plural", () => {
  it("picks the form by count", () => {
    expect(plural(1, "match", "matches")).toBe("1 match");
    expect(plural(0, "match", "matches")).toBe("0 matches");
    expect(plural(12, "note", "notes")).toBe("12 notes");
  });
});

describe("peopleSearchStatus", () => {
  it("says nothing before a question is asked", () => {
    expect(peopleSearchStatus(people({ query: "" }))).toBe("");
    expect(peopleSearchStatus(people({}))).toBe("");
  });

  it("says that the search started", () => {
    expect(peopleSearchStatus(people({ isLoading: true }))).toBe(
      "Searching your network for “who likes espresso”…",
    );
  });

  it("says keyword candidates arrived while AI is still working", () => {
    expect(
      peopleSearchStatus(
        people({ isEnriching: true, count: 4, fallback: true }),
      ),
    ).toBe("4 keyword candidates for “who likes espresso”. Enriching with AI…");
    expect(
      peopleSearchStatus(
        people({ isEnriching: true, count: 1, fallback: true }),
      ),
    ).toBe("1 keyword candidate for “who likes espresso”. Enriching with AI…");
  });

  it("counts the matches when the answer is complete", () => {
    expect(peopleSearchStatus(people({ hasSearched: true, count: 3 }))).toBe(
      "3 matches for “who likes espresso”.",
    );
    expect(peopleSearchStatus(people({ hasSearched: true, count: 1 }))).toBe(
      "1 match for “who likes espresso”.",
    );
  });

  it("says when nothing matched", () => {
    expect(peopleSearchStatus(people({ hasSearched: true, count: 0 }))).toBe(
      "No matches for “who likes espresso”.",
    );
  });

  it("says that AI was unavailable and the matches are by keyword", () => {
    expect(
      peopleSearchStatus(
        people({ hasSearched: true, count: 2, fallback: true }),
      ),
    ).toBe("AI unavailable. 2 matches for “who likes espresso” by keyword.");
  });

  it("says nothing on an error, which the visible alert announces", () => {
    expect(
      peopleSearchStatus(
        people({ hasSearched: true, isError: true, count: 0 }),
      ),
    ).toBe("");
  });

  it("trims the question it quotes", () => {
    expect(
      peopleSearchStatus(people({ isLoading: true, query: "  espresso  " })),
    ).toBe("Searching your network for “espresso”…");
  });
});

describe("noteSearchStatus", () => {
  it("says nothing when nothing is being searched for", () => {
    expect(noteSearchStatus(notes({ hasSearch: false, isSuccess: true }))).toBe(
      "",
    );
  });

  it("says that the search started", () => {
    expect(noteSearchStatus(notes({ isFetching: true }))).toBe(
      "Searching notes…",
    );
  });

  it("counts the notes across every page", () => {
    expect(noteSearchStatus(notes({ isSuccess: true, total: 41 }))).toBe(
      "41 notes for “hiring”.",
    );
    expect(noteSearchStatus(notes({ isSuccess: true, total: 1 }))).toBe(
      "1 note for “hiring”.",
    );
  });

  it("says when no note matched", () => {
    expect(noteSearchStatus(notes({ isSuccess: true, total: 0 }))).toBe(
      "No notes match for “hiring”.",
    );
  });

  it("describes a period-only search without quoting an empty question", () => {
    expect(
      noteSearchStatus(notes({ isSuccess: true, total: 5, query: "" })),
    ).toBe("5 notes in this period.");
    expect(
      noteSearchStatus(notes({ isSuccess: true, total: 0, query: "" })),
    ).toBe("No notes match in this period.");
  });

  it("says nothing on an error, which the visible alert announces", () => {
    expect(noteSearchStatus(notes({ isError: true, total: 0 }))).toBe("");
  });
});

describe("LiveStatus", () => {
  it("is a polite, atomic status region that is present while empty", () => {
    render(<LiveStatus message="" label="Search status" />);
    const region = screen.getByRole("status", { name: "Search status" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent).toBe("");
  });

  it("does not speak the value it mounted with", () => {
    render(<LiveStatus message="3 matches for “x”." label="Search status" />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("speaks every change after mount, including a return to the first value", async () => {
    const { rerender } = render(
      <LiveStatus message="" label="Search status" />,
    );
    const region = screen.getByRole("status");

    await act(async () => {
      rerender(<LiveStatus message="Searching…" label="Search status" />);
    });
    expect(region.textContent).toBe("Searching…");

    await act(async () => {
      rerender(
        <LiveStatus message="2 matches for “x”." label="Search status" />,
      );
    });
    expect(region.textContent).toBe("2 matches for “x”.");

    // Clearing the search empties the region rather than leaving a stale
    // count in it for the next announcement to be compared against.
    await act(async () => {
      rerender(<LiveStatus message="" label="Search status" />);
    });
    expect(region.textContent).toBe("");
  });
});
