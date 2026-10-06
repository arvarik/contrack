// @vitest-environment jsdom
// =============================================================================
// Unit: the Research card's next steps and "Not this person"
// =============================================================================
// When the latest research found nobody, found little, or was taken back,
// the card asks for one more detail: a school and a former name typed in the
// card, which save and search again at once, and a city, a work email or a
// link opened on the page. Each run in the history can be taken back as
// someone else with the same name.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
// AI is set up: the Enrich buttons ask `useAiSetup`.
vi.mock("../../../../src/hooks/useAiSetup", () => ({
  useAiSetup: () => null,
  aiSetupLine: () => "",
}));
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const aiSearch = vi.hoisted(() => ({
  startSearch: vi.fn(),
  isStarting: false,
  batch: null as null | {
    status: "processing" | "complete" | "cancelled";
    jobs: { contactId: string; status: string }[];
  },
  depthFiguresApply: true,
  runsEngine: "provider" as const,
  webSearchProvider: "Google Gemini",
}));
vi.mock("../../../../src/contexts/AISearchContext", async (original) => ({
  isEnriching: (
    await original<typeof import("../../../../src/contexts/AISearchContext")>()
  ).isEnriching,
  useAISearch: () => aiSearch,
  useOptionalAISearch: () => aiSearch,
}));
const ai = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => ai.allowed,
}));
/** The contact writes the card makes. Each succeeds at once. */
const writes = vi.hoisted(() => ({
  update: vi.fn((_vars: unknown, options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.(),
  ),
  reject: vi.fn(
    (
      _vars: unknown,
      options?: { onSuccess?: (answer: { removed: number }) => void },
    ) => options?.onSuccess?.({ removed: 3 }),
  ),
}));
vi.mock("../../../../src/api/contacts", () => ({
  useUpdateContact: () => ({ mutate: writes.update, isPending: false }),
  useRejectResearchRun: () => ({ mutate: writes.reject, isPending: false }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { ResearchCard } from "../../../../src/views/contact-detail/components/ResearchCard";
import type { Contact } from "../../../../src/types";

const RUN_AT = "2026-10-05T10:00:00.000Z";

/** A contact whose one research run ended as `run` says. */
function researched(
  run: Record<string, unknown>,
  fields: Partial<Contact> = {},
  record: Record<string, unknown> = {},
): Contact {
  return {
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
    attributes: [],
    aiHydratedAt: RUN_AT,
    aiResearch: JSON.stringify({
      version: 1,
      runs: [
        {
          at: RUN_AT,
          models: ["gemini-3.8-flash"],
          depth: "standard",
          outcome: "no-public-info",
          added: [],
          sourceCount: 0,
          queries: [],
          findings: [],
          ...run,
        },
      ],
      sources: [],
      ...record,
    }),
    ...fields,
  } as unknown as Contact;
}

afterEach(() => {
  cleanup();
  aiSearch.startSearch.mockClear();
  aiSearch.batch = null;
  ai.allowed = true;
  writes.update.mockClear();
  writes.reject.mockClear();
  toasts.success.mockClear();
});

describe("one more detail, typed in the card", () => {
  it("saves a school and searches again at the last run's depth", () => {
    const contact = researched({ depth: "deep" });
    render(<ResearchCard contact={contact} onAddDetail={vi.fn()} />);
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    fireEvent.click(
      within(steps).getByRole("button", { name: "Add a school" }),
    );
    const field = within(steps).getByLabelText("School");
    expect(document.activeElement).toBe(field);
    const save = within(steps).getByRole("button", { name: "Save and search" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, {
      target: { value: "  University of Example  " },
    });
    fireEvent.click(save);
    expect(writes.update).toHaveBeenCalledWith(
      {
        id: "c1",
        data: { education: [{ school: "University of Example" }] },
      },
      expect.anything(),
    );
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
      limitAs: "toast",
      depth: "deep",
    });
  });

  it("saves a former name beside the contact's other facts", () => {
    render(
      <ResearchCard
        contact={researched({}, {
          attributes: [{ name: "Awards", value: "Dean's List" }],
        } as Partial<Contact>)}
        onAddDetail={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a former name" }));
    fireEvent.change(screen.getByLabelText("Former name"), {
      target: { value: "Rowan Ellis" },
    });
    fireEvent.submit(screen.getByLabelText("Former name").closest("form")!);
    expect(writes.update).toHaveBeenCalledWith(
      {
        id: "c1",
        data: {
          attributes: [
            { name: "Awards", value: "Dean's List" },
            { name: "Former name", value: "Rowan Ellis" },
          ],
        },
      },
      expect.anything(),
    );
  });

  it("closes on Escape, and gives focus back to its button", () => {
    render(<ResearchCard contact={researched({})} onAddDetail={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Add a school" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("School"), { key: "Escape" });
    expect(screen.queryByLabelText("School")).toBeNull();
    // Focus returns on the next frame.
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        expect(document.activeElement?.textContent).toBe("Add a school");
        resolve();
      }),
    );
  });

  it("only saves while research is off", () => {
    ai.allowed = false;
    render(<ResearchCard contact={researched({})} onAddDetail={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a school" }));
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "University of Example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.update).toHaveBeenCalled();
    expect(aiSearch.startSearch).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith("Added the school");
  });
});

describe("when the latest research found little", () => {
  it("asks for a detail after a run that added two details or fewer", () => {
    render(
      <ResearchCard
        contact={researched({
          outcome: "added",
          added: [
            { field: "headline", count: 1 },
            { field: "experience", count: 1 },
          ],
          sourceCount: 2,
        })}
        onAddDetail={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Research found little about Rowan" }),
    ).toBeTruthy();
  });

  it("does not call a run that found nothing new thin", () => {
    render(
      <ResearchCard
        contact={researched({ outcome: "nothing-new", sourceCount: 3 })}
        onAddDetail={vi.fn()}
      />,
    );
    expect(screen.queryByRole("region", { name: /found little/ })).toBeNull();
  });

  it("offers Search again once a detail was added on the page", () => {
    const contact = researched({});
    const view = render(
      <ResearchCard contact={contact} onAddDetail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Search again" })).toBeNull();
    view.rerender(
      <ResearchCard
        contact={{ ...contact, location: "Boston, MA" }}
        onAddDetail={vi.fn()}
      />,
    );
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    expect(steps.textContent).toContain("With the details you added");
    fireEvent.click(
      within(steps).getByRole("button", { name: "Search again" }),
    );
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
      limitAs: "toast",
      depth: "standard",
    });
  });

  it("says research runs, and offers nothing, while it does", () => {
    aiSearch.batch = {
      status: "processing",
      jobs: [{ contactId: "c1", status: "searching" }],
    };
    render(<ResearchCard contact={researched({})} onAddDetail={vi.fn()} />);
    const steps = screen.getByRole("region", {
      name: "No web page matched Rowan",
    });
    expect(within(steps).getByRole("status").textContent).toBe(
      "Searching again",
    );
    expect(within(steps).queryAllByRole("button")).toEqual([]);
  });
});

describe("Not this person", () => {
  const found = () =>
    researched(
      {
        outcome: "added",
        added: [
          { field: "experience", count: 2 },
          { field: "education", count: 1 },
        ],
        sourceCount: 2,
      },
      {},
      {
        sources: [
          {
            url: "https://athletics.example/roster/rowan-vale",
            title: "Roster",
            firstSeenAt: RUN_AT,
          },
          {
            url: "https://news.example/rowan-vale",
            title: "News",
            firstSeenAt: RUN_AT,
          },
        ],
        addedEntries: [
          { field: "experience", value: "Harbor Point", at: RUN_AT },
          { field: "experience", value: "Kestrel", at: RUN_AT },
          { field: "education", value: "Example College", at: RUN_AT },
        ],
      },
    );

  it("takes back a run after saying what goes, and then asks for a detail", () => {
    const view = render(
      <ResearchCard contact={found()} onAddDetail={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Search of .*, actions$/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Not Rowan" }));
    const dialog = screen.getByRole("dialog", {
      name: "Take back this search?",
    });
    expect(dialog.textContent).toContain(
      "found someone else named Rowan Vale. What it added goes: Roles ×2, Education. A detail you changed since stays",
    );
    expect(dialog.textContent).toContain(
      "Its 2 pages stay out of later searches",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Take back 3 details" }),
    );
    expect(writes.reject).toHaveBeenCalledWith(
      { id: "c1", runAt: RUN_AT },
      expect.anything(),
    );
    expect(toasts.success).toHaveBeenCalledWith("Took back 3 details");

    // The server marks the run, and the card asks for what tells Rowan apart.
    const taken = JSON.parse(found().aiResearch!);
    taken.runs[0] = { ...taken.runs[0], rejected: true, findings: [] };
    taken.sources = [];
    view.rerender(
      <ResearchCard
        contact={{ ...found(), aiResearch: JSON.stringify(taken) }}
        onAddDetail={vi.fn()}
      />,
    );
    const steps = screen.getByRole("region", {
      name: "Help research find the right Rowan",
    });
    expect(document.activeElement?.textContent).toBe(
      "Help research find the right Rowan",
    );
    expect(steps.textContent).toContain("Without the pages you took back");
    fireEvent.click(
      within(steps).getByRole("button", { name: "Search again" }),
    );
    expect(aiSearch.startSearch).toHaveBeenCalled();
    // The run says what happened, and is not offered again.
    expect(
      screen.getByText("Someone else with this name, taken back"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Search of .*, actions$/ }),
    ).toBeNull();
  });

  it("is not offered for a run from before runs named what they added, nor on an archived contact", () => {
    const legacy = JSON.parse(found().aiResearch!);
    legacy.addedEntries = legacy.addedEntries.map(
      ({ at: _at, ...entry }: { at: string }) => entry,
    );
    const { unmount } = render(
      <ResearchCard
        contact={{ ...found(), aiResearch: JSON.stringify(legacy) }}
        onAddDetail={vi.fn()}
      />,
    );
    // It could not take back what it added, so it is not offered.
    expect(
      screen.queryByRole("button", { name: /^Search of .*, actions$/ }),
    ).toBeNull();
    unmount();
    render(
      <ResearchCard
        contact={{ ...found(), isArchived: true } as Contact}
        onAddDetail={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /^Search of .*, actions$/ }),
    ).toBeNull();
  });

  it("is not offered for a run with nothing to take back", () => {
    render(
      <ResearchCard
        contact={researched({ outcome: "nothing-new" })}
        onAddDetail={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /^Search of .*, actions$/ }),
    ).toBeNull();
  });
});
