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
// AI is set up: the Enrich buttons ask `useAiSetup`.
vi.mock("../../../../src/hooks/useAiSetup", () => ({
  useAiSetup: () => null,
  useBlockedAi: () => null,
  aiSetupLine: () => "",
}));
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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
  depthFiguresApply: true,
  webSearchProvider: "Google Gemini" as string | null,
  engine: "provider" as "provider" | "searxng" | "combined",
  runsEngine: "provider" as "provider" | "searxng" | "combined" | null,
}));
vi.mock("../../../../src/contexts/AISearchContext", async (original) => ({
  isEnriching: (
    await original<typeof import("../../../../src/contexts/AISearchContext")>()
  ).isEnriching,
  useAISearch: () => aiSearch,
  useOptionalAISearch: () => aiSearch,
}));

/** Whether AI assistance is on for the account. */
const ai = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => ai.allowed,
}));

/** The contact writes the Research card makes. */
const writes = vi.hoisted(() => ({ update: vi.fn(), reject: vi.fn() }));
vi.mock("../../../../src/api/contacts", () => ({
  useUpdateContact: () => ({ mutate: writes.update, isPending: false }),
  useRejectResearchRun: () => ({ mutate: writes.reject, isPending: false }),
}));
const contacts = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../../../src/api", () => ({
  useContacts: () => ({ data: contacts.list, isLoading: false }),
}));

import {
  aboutTime,
  batchEstimate,
  depthTime,
  dollars,
  perContact,
} from "../../../../src/lib/researchDepth";
import { RESEARCH_DEPTH_FIGURES } from "../../../../shared/researchDepth";
import { EnrichMenu } from "../../../../src/views/contact-detail/components/EnrichMenu";
import { ResearchCard } from "../../../../src/views/contact-detail/components/ResearchCard";
import { DossierTab } from "../../../../src/views/contact-detail/components/DossierTab";
import { AISearchView } from "../../../../src/views/ai-search/AISearchView";
import { AISearchProgressOverlay } from "../../../../src/views/ai-search/components/AISearchProgressOverlay";

/** Where the router is: the address, and the state a link handed over. */
function Where() {
  const location = useLocation();
  return (
    <output
      data-testid="where"
      data-state={JSON.stringify(location.state ?? null)}
    >
      {location.pathname}
      {location.search}
    </output>
  );
}

/**
 * The Enrichment page's view at an address, beside the contact route a row
 * opens. `rerenderView` gives the view new props in the same router.
 */
function renderView(
  props: React.ComponentProps<typeof AISearchView> = {},
  path = "/settings/enrichment",
) {
  const tree = (viewProps: React.ComponentProps<typeof AISearchView>) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/enrichment"
          element={<AISearchView {...viewProps} />}
        />
        <Route path="/contact/:id" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
  const view = render(tree(props));
  return {
    ...view,
    rerenderView: (next: React.ComponentProps<typeof AISearchView>) =>
      view.rerender(tree(next)),
  };
}
import type { AISearchBatch, Contact } from "../../../../src/types";

afterEach(() => {
  cleanup();
  aiSearch.startSearch.mockClear();
  aiSearch.isStarting = false;
  aiSearch.batch = null;
  aiSearch.depthFiguresApply = true;
  aiSearch.webSearchProvider = "Google Gemini";
  aiSearch.engine = "provider";
  aiSearch.runsEngine = "provider";
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
    expect(within(menu).getByText("Depth")).toBeTruthy();
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

  it("names SearXNG or both in its heading when research runs on them", () => {
    aiSearch.runsEngine = "searxng";
    render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Enrich again, choose how deep/ }),
    );
    expect(
      within(screen.getByRole("menu")).getByText("Depth · with SearXNG"),
    ).toBeTruthy();
    cleanup();
    aiSearch.runsEngine = "combined";
    render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Enrich again, choose how deep/ }),
    );
    expect(
      within(screen.getByRole("menu")).getByText(
        "Depth · with Google Gemini and SearXNG",
      ),
    ).toBeTruthy();
  });

  it("gives no time when research runs on a provider the figures were not measured on", () => {
    aiSearch.depthFiguresApply = false;
    render(
      <EnrichMenu contact={person} label="Enrich again" variant="secondary" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Enrich again, choose how deep/ }),
    );
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Standard", "Deep"]);
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
    // Only what the page can take by hand: a note fills no field.
    expect(
      screen.getByText(
        "The dossier fills in from enrichment and imports. You can add a city, an email or a link by hand",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/note/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
  });
});

describe("the Research card, when research found nobody", () => {
  /** A contact whose one research run found no page, at this depth. */
  const nobody = (
    depth: "standard" | "deep",
    fields: Partial<Contact> = {},
  ): Contact =>
    ({
      id: "c1",
      name: "Rowan Vale",
      firstName: "Rowan",
      company: "Northwind Partners",
      role: "Associate",
      emails: [],
      addresses: [],
      socialLinks: [
        { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
      ],
      education: [],
      aiHydratedAt: "2026-09-26T22:00:00.000Z",
      aiResearch: JSON.stringify({
        version: 1,
        runs: [
          {
            at: "2026-09-26T22:00:00.000Z",
            models: ["gemini-3.8-flash"],
            depth,
            outcome: "no-public-info",
            added: [],
            sourceCount: 0,
            queries: [],
            findings: [],
          },
        ],
        sources: [],
      }),
      ...fields,
    }) as unknown as Contact;

  it("says what research searched with, and offers the details that would help it", () => {
    const onAddDetail = vi.fn();
    render(
      <ResearchCard contact={nobody("standard")} onAddDetail={onAddDetail} />,
    );
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    expect(steps.textContent).toContain(
      "Research searched with Rowan’s name, company, role and LinkedIn profile",
    );
    // The three that help most: one row of the dossier's column.
    expect(
      within(steps)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a school", "Add a city", "Add a former name"]);
    fireEvent.click(within(steps).getByRole("button", { name: "Add a city" }));
    expect(onAddDetail).toHaveBeenCalledWith("city");
    // No page to check a detail against, so no line asking to.
    expect(screen.queryByText(/Check a detail against its page/)).toBeNull();
  });

  it("offers only what is missing, and no Deep after a Deep run", () => {
    render(
      <ResearchCard
        contact={nobody("deep", {
          location: "New York, NY",
          emails: [{ email: "rv@northwind.example" }] as Contact["emails"],
        })}
        onAddDetail={vi.fn()}
      />,
    );
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    // The LinkedIn profile is a link already, so the offer is another one.
    expect(
      within(steps)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a school", "Add a former name", "Add another link"]);
    expect(steps.textContent).not.toContain("Deep runs a longer search");
  });

  it("offers Deep alone when no detail is missing, and says when it had the name alone", () => {
    const { unmount } = render(
      <ResearchCard
        contact={nobody("standard", {
          location: "New York, NY",
          emails: [{ email: "rv@northwind.example" }] as Contact["emails"],
          socialLinks: [
            { platform: "github", url: "https://github.com/rowanv" },
          ] as Contact["socialLinks"],
          education: [
            { school: "University of Example" },
          ] as Contact["education"],
          attributes: [
            { name: "Former name", value: "Rowan Ellis" },
          ] as Contact["attributes"],
        })}
        onAddDetail={vi.fn()}
      />,
    );
    let steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    expect(within(steps).queryAllByRole("button")).toEqual([]);
    expect(steps.textContent).toContain(
      "Choose Enrich again, then Deep, for a longer search",
    );
    unmount();

    render(
      <ResearchCard
        contact={nobody("standard", {
          company: null,
          role: null,
          socialLinks: [],
        } as Partial<Contact>)}
        onAddDetail={vi.fn()}
      />,
    );
    steps = screen.getByRole("region", { name: "No web page matched Rowan" });
    expect(steps.textContent).toContain(
      "Research searched with Rowan’s name alone",
    );
    expect(
      within(steps)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a school", "Add a city", "Add a former name"]);
  });

  it("names no Enrich again when research is off, and still offers the details", () => {
    ai.allowed = false;
    render(<ResearchCard contact={nobody("standard")} onAddDetail={vi.fn()} />);
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    expect(
      within(steps)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a school", "Add a city", "Add a former name"]);
    expect(steps.textContent).not.toContain("Enrich again");
    expect(screen.queryByRole("button", { name: /^Enrich again/ })).toBeNull();
  });

  it("says nothing of the kind once a later run found pages", () => {
    const later = nobody("standard");
    const record = JSON.parse(later.aiResearch!);
    record.runs.push({
      ...record.runs[0],
      outcome: "added",
      at: "2026-09-27T00:00:00.000Z",
    });
    render(
      <ResearchCard
        contact={{ ...later, aiResearch: JSON.stringify(record) }}
        onAddDetail={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("region", { name: /No web page matched/ }),
    ).toBeNull();
  });
});

describe("the Enrichment page's depth", () => {
  const people = [
    { id: "c1", name: "Rowan Vale", isArchived: false, isGhost: false },
    { id: "c2", name: "Kestrel Ames", isArchived: false, isGhost: false },
  ];

  it("names, describes and prices both depths, Standard chosen", () => {
    contacts.list = people;
    renderView();
    const group = screen.getByRole("radiogroup", { name: "Depth" });
    const tiles = within(group).getAllByRole("radio");
    expect(tiles.map((tile) => tile.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    expect(tiles[0].textContent).toContain(perContact("standard"));
    expect(tiles[1].textContent).toContain(perContact("deep"));
    // The costs by provider sit behind a question mark, not under the tiles.
    expect(screen.queryByText(/first 5,000 web searches/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Estimated research costs" }),
    ).toBeTruthy();
  });

  it("starts the batch at the chosen depth, after saying its time and cost", () => {
    contacts.list = people;
    renderView();
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

  it("leaves out Gemini's figures when research runs on another provider", () => {
    aiSearch.depthFiguresApply = false;
    contacts.list = people;
    renderView();
    const tiles = within(
      screen.getByRole("radiogroup", { name: "Depth" }),
    ).getAllByRole("radio");
    expect(tiles[0].textContent).not.toContain(perContact("standard"));
    expect(tiles[1].textContent).not.toContain(perContact("deep"));
    // The question mark stays: it compares the providers, so it helps most
    // to a person whose research does not run on Gemini.
    expect(
      screen.getByRole("button", { name: "Estimated research costs" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(screen.queryByText(/in all/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start enrichment/ }));
    expect(screen.getByRole("dialog").textContent).not.toContain("in all");
  });
});

describe("the Enrichment tool's engine", () => {
  const people = [
    { id: "c1", name: "Rowan Vale", isArchived: false, isGhost: false },
    { id: "c2", name: "Kestrel Ames", isArchived: false, isGhost: false },
  ];
  /** The tool with research running on `engine`, the dialog open for both people. */
  const confirmOn = (engine: "provider" | "searxng" | "combined") => {
    aiSearch.runsEngine = engine;
    aiSearch.depthFiguresApply = engine === "provider";
    contacts.list = people;
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start enrichment/ }));
    return screen.getByRole("dialog");
  };

  it("leaves the choice to the page's settings card, not the tool", () => {
    contacts.list = people;
    renderView();
    expect(
      screen.queryByRole("radiogroup", { name: "Web search engine" }),
    ).toBeNull();
  });

  it("says SearXNG, and what it costs, before a batch starts, without Gemini's figures", () => {
    const dialog = confirmOn("searxng");
    expect(dialog.textContent).toContain(
      "Searches with SearXNG. Free searches on your SearXNG",
    );
    expect(dialog.textContent).not.toContain("in all");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Search 2 contacts" }),
    );
    // The start names the depth. The context names the engine that runs.
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1", "c2"], {
      depth: "standard",
    });
  });

  it("names both engines before a batch starts", () => {
    expect(confirmOn("combined").textContent).toContain(
      "Searches with Google Gemini and SearXNG",
    );
  });

  it("gives the provider's time and cost, and no engine line, for its own search", () => {
    const dialog = confirmOn("provider");
    expect(dialog.textContent).toContain(batchEstimate("standard", 2));
    expect(dialog.textContent).not.toContain("Searches with");
  });
});

describe("the Enrichment page's filters", () => {
  const OLD = new Date(Date.now() - 200 * 864e5).toISOString();
  const RECENT = new Date(Date.now() - 864e5).toISOString();
  const people = [
    {
      id: "c1",
      name: "Rowan Vale",
      isArchived: false,
      isGhost: false,
      isTracked: true,
      aiHydratedAt: OLD,
      researchOutcome: "added",
    },
    {
      id: "c2",
      name: "Kestrel Ames",
      isArchived: false,
      isGhost: false,
      isTracked: true,
      aiHydratedAt: null,
      researchOutcome: null,
    },
    {
      id: "c3",
      name: "Juniper Hale",
      isArchived: false,
      isGhost: false,
      isTracked: false,
      aiHydratedAt: RECENT,
      researchOutcome: "no-public-info",
    },
  ];

  /** A row's pills, as "label count". */
  const pills = (row: string) =>
    within(screen.getByRole("group", { name: row }))
      .getAllByRole("button")
      .map((pill) => pill.textContent);

  it("counts every pill beside the other row's choice", () => {
    contacts.list = people;
    renderView();
    expect(pills("Contacts")).toEqual([
      "All3",
      "Tracked2",
      "Has links0",
      "Has email0",
      "No data3",
    ]);
    expect(pills("Research")).toEqual([
      "Any3",
      "Not yet1",
      "6+ months ago1",
      "Found nothing1",
    ]);
    // Tracked in the first row: the second row counts the tracked only.
    fireEvent.click(screen.getByRole("button", { name: /^Tracked/ }));
    expect(pills("Research")).toEqual([
      "Any2",
      "Not yet1",
      "6+ months ago1",
      "Found nothing0",
    ]);
    expect(
      screen
        .getByRole("button", { name: /^Tracked/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("shows the contacts that match both rows, and marks a found-nothing row", () => {
    contacts.list = people;
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Found nothing/ }));
    expect(screen.getByText("Juniper Hale")).toBeTruthy();
    expect(screen.queryByText("Rowan Vale")).toBeNull();
    expect(screen.getByText(/No page/)).toBeTruthy();
    // Tracked and found nothing: nobody, and a way back.
    fireEvent.click(screen.getByRole("button", { name: /^Tracked/ }));
    expect(
      screen.getByText("No contacts match the current filter"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Rowan Vale")).toBeTruthy();
    expect(screen.getByText("Kestrel Ames")).toBeTruthy();
  });

  it("keeps the filters in the page address, so Back comes back to the same list", () => {
    contacts.list = people;
    renderView({}, "/settings/enrichment?research=found_nothing");
    expect(
      within(screen.getByRole("group", { name: "Research" }))
        .getByRole("button", { name: /^Found nothing/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Juniper Hale")).toBeTruthy();
    expect(screen.queryByText("Rowan Vale")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Tracked/ }));
    expect(screen.getByTestId("where").textContent).toBe(
      "/settings/enrichment?research=found_nothing&contacts=tracked",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("where").textContent).toBe(
      "/settings/enrichment",
    );
  });

  it("opens a contact from its row, and hands the contact page the way back", () => {
    contacts.list = people;
    renderView({}, "/settings/enrichment?research=found_nothing");
    const open = screen.getByRole("link", { name: "Open Juniper Hale" });
    expect(open.getAttribute("href")).toBe("/contact/c3");
    fireEvent.click(open);
    const where = screen.getByTestId("where");
    expect(where.textContent).toBe("/contact/c3");
    expect(JSON.parse(where.getAttribute("data-state") ?? "null")).toEqual({
      back: {
        to: "/settings/enrichment?research=found_nothing",
        label: "Contact enrichment",
      },
    });
  });

  it("says the selection's time and cost under the start button", () => {
    contacts.list = people;
    renderView();
    expect(screen.queryByText(/in all/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(
      screen.getByText(`Standard · ${batchEstimate("standard", 3)}`),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^Deep/ }));
    // A new depth keeps the selection, and the line follows it.
    expect(screen.getByText(`Deep · ${batchEstimate("deep", 3)}`)).toBeTruthy();
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
