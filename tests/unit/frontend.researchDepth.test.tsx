// @vitest-environment jsdom
// =============================================================================
// Unit: the two research depths, wherever research starts
// =============================================================================
// Standard and Deep, named and timed the same way in the dossier's enrich
// menus, the empty dossier, the Enrichment page and its confirmation, and
// the progress panel. The figures come from shared/researchDepth.ts, so the
// tests read them from there rather than copy them.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** The enrichment context: what is running, and what was started. */
const aiSearch = vi.hoisted(() => ({
  startSearch: vi.fn(),
  isStarting: false,
  batch: null as null | {
    status: "processing" | "complete" | "cancelled";
    jobs: { contactId: string; status: string }[];
  },
  limitMessage: null,
  clearLimit: vi.fn(),
}));
vi.mock("../../src/contexts/AISearchContext", async (original) => ({
  isEnriching: (
    await original<typeof import("../../src/contexts/AISearchContext")>()
  ).isEnriching,
  useAISearch: () => aiSearch,
  useOptionalAISearch: () => aiSearch,
}));

/** Whether AI assistance is on for the account. */
const ai = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => ai.allowed,
}));

const contacts = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../src/api", () => ({
  useContacts: () => ({ data: contacts.list, isLoading: false }),
}));

import {
  aboutTime,
  batchEstimate,
  depthTime,
  dollars,
  perContact,
} from "../../src/lib/researchDepth";
import { RESEARCH_DEPTH_FIGURES } from "../../shared/researchDepth";
import { EnrichMenu } from "../../src/views/contact-detail/components/EnrichMenu";
import { DossierTab } from "../../src/views/contact-detail/components/DossierTab";
import { AISearchView } from "../../src/views/ai-search/AISearchView";
import { AISearchProgressOverlay } from "../../src/views/ai-search/components/AISearchProgressOverlay";
import type { AISearchBatch, Contact } from "../../src/types";

afterEach(() => {
  cleanup();
  aiSearch.startSearch.mockClear();
  aiSearch.isStarting = false;
  aiSearch.batch = null;
  ai.allowed = true;
  contacts.list = [];
});

describe("the depth's words", () => {
  it("says a time to the nearest 10 s under a minute, else in whole minutes", () => {
    expect(aboutTime(4)).toBe("about 10 s");
    expect(aboutTime(41)).toBe("about 40 s");
    expect(aboutTime(60)).toBe("about 1 min");
    expect(aboutTime(89)).toBe("about 1 min");
    expect(aboutTime(130)).toBe("about 2 min");
  });

  it("says a cost in dollars and cents, and a cost under a cent as that", () => {
    expect(dollars(0.126)).toBe("$0.13");
    expect(dollars(0.004)).toBe("under $0.01");
  });

  it("prices a contact and a batch from the measured figures", () => {
    const deep = RESEARCH_DEPTH_FIGURES.deep;
    expect(perContact("deep")).toBe(
      `${aboutTime(deep.seconds).replace("about", "About")} and ${dollars(deep.costUsd)} a contact`,
    );
    // Ten contacts one after another, with nine pauses of 2.5 s.
    expect(batchEstimate("deep", 10)).toBe(
      `${aboutTime(10 * deep.seconds + 9 * 2.5).replace("about", "About")} and ${dollars(10 * deep.costUsd)} in all`,
    );
    // Deep takes longer and costs more than Standard, whatever the figures.
    expect(deep.seconds).toBeGreaterThan(
      RESEARCH_DEPTH_FIGURES.standard.seconds,
    );
    expect(deep.costUsd).toBeGreaterThan(
      RESEARCH_DEPTH_FIGURES.standard.costUsd,
    );
  });
});

describe("EnrichMenu", () => {
  const person = { id: "c1", isGhost: false };

  it("opens the two depths, each with its time, and starts the one chosen", () => {
    render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Enrich again, choose how deep/ }),
    );
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Research depth")).toBeTruthy();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      `Standard, ${depthTime("standard")}`,
      `Deep, ${depthTime("deep")}`,
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Deep/ }));
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
      limitAs: "toast",
      depth: "deep",
    });
  });

  it("reads Enriching… and waits while this contact's research runs", () => {
    aiSearch.batch = {
      status: "processing",
      jobs: [{ contactId: "c1", status: "searching" }],
    };
    render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    const button = screen.getByRole("button", { name: "Enriching…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("is not there without AI assistance, or for a ghost", () => {
    ai.allowed = false;
    const { unmount } = render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    ai.allowed = true;
    render(
      <EnrichMenu
        contact={{ id: "c1", isGhost: true }}
        label="Enrich again"
        variant="secondary"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the empty dossier", () => {
  const empty = { id: "c1", name: "Rowan Vale", firstName: "Rowan" } as Contact;

  it("says what enrichment finds, and starts it from here", () => {
    render(
      <MemoryRouter>
        <DossierTab contact={empty} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "Enrichment searches the web for Rowan’s work, schools and profiles, and links each fact to its page",
      ),
    ).toBeTruthy();
    // Not a link to the Enrichment page any more: the research starts here.
    expect(screen.queryByRole("link", { name: /Enrich/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /^Enrich contact, choose how deep/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /^Standard/ }));
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
      limitAs: "toast",
      depth: "standard",
    });
  });

  it("offers the manual way alone without AI assistance", () => {
    ai.allowed = false;
    render(
      <MemoryRouter>
        <DossierTab contact={empty} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "Add Rowan’s work, schools and profiles in the details, or paste a bio into a note",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
  });
});

describe("the Enrichment page's depth", () => {
  const people = [
    { id: "c1", name: "Rowan Vale", isArchived: false, isGhost: false },
    { id: "c2", name: "Kestrel Ames", isArchived: false, isGhost: false },
  ];

  it("names, describes and prices both depths, Standard chosen", () => {
    contacts.list = people;
    render(<AISearchView />);
    const group = screen.getByRole("radiogroup", { name: "Research depth" });
    const tiles = within(group).getAllByRole("radio");
    expect(tiles.map((tile) => tile.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    expect(tiles[0].textContent).toContain(perContact("standard"));
    expect(tiles[1].textContent).toContain(perContact("deep"));
    expect(screen.getByText(/The first 5,000 web searches/)).toBeTruthy();
  });

  it("starts the batch at the chosen depth, after saying its time and cost", () => {
    contacts.list = people;
    render(<AISearchView />);
    fireEvent.click(screen.getByRole("radio", { name: /^Deep/ }));
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start enrichment/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(batchEstimate("deep", 2));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Search 2 contacts" }),
    );
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1", "c2"], {
      depth: "deep",
    });
  });
});

describe("the progress panel", () => {
  it("marks a Deep job, and leaves the default unsaid", () => {
    const batch = {
      id: "b1",
      strategy: "two-pass",
      createdAt: "2026-09-26T00:00:00.000Z",
      status: "processing",
      totalTokens: 0,
      jobs: [
        {
          id: "j1",
          contactId: "c1",
          contactName: "Rowan Vale",
          status: "searching",
          fieldsUpdated: 0,
          depth: "deep",
        },
        {
          id: "j2",
          contactId: "c2",
          contactName: "Kestrel Ames",
          status: "queued",
          fieldsUpdated: 0,
          depth: "standard",
        },
      ],
    } as AISearchBatch;
    render(
      <AISearchProgressOverlay
        batch={batch}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
        isCancelling={false}
        connectionError={false}
      />,
    );
    expect(screen.getAllByText("Deep")).toHaveLength(1);
    expect(screen.queryByText("Standard")).toBeNull();
  });
});
