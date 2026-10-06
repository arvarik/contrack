// @vitest-environment jsdom
// =============================================================================
// Possible duplicates: the keys, the choice of the contact to keep, and Undo
// =============================================================================
// A merge changes a person's data, so every case here guards a way the list
// used to merge the wrong thing or hide how to take it back:
//
// - An arrow pressed to choose the contact to keep also merged the group,
//   into the contact the engine had suggested, in the same key press.
// - A key merge ignored the contact a person had chosen.
// - The caveat that says "look twice" was behind a click.
// - Only a key merge offered Undo, and Keep separate offered none.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { DuplicateQueue } from "../../../../src/views/dedupe/components/DuplicateQueue";
import type {
  PersistedDedupeSuggestion,
  SuggestedContact,
} from "../../../../src/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: { singleKeyShortcuts: true, aiAssist: true, motion: "system" },
  }),
}));
// The check's own card is tested with the Settings page. Here it is idle.
vi.mock("../../../../src/views/dedupe/components/DuplicateCheck", () => ({
  DuplicateCheck: () => null,
  useDuplicateCheck: () => ({
    isScanning: false,
    isStarting: false,
    isQueued: false,
    start: vi.fn(),
  }),
}));
let wide = true;
vi.mock("../../../../src/hooks/useMediaQuery", () => ({
  WIDE_QUERY: "(min-width: 1024px)",
  useMediaQuery: () => wide,
}));

function person(
  id: string,
  name: string,
  extra: object = {},
): SuggestedContact {
  return {
    id,
    name,
    emails: [],
    phones: [],
    socialLinks: [],
    tags: [],
    lists: [],
    sources: [],
    interactionCount: 0,
    ...extra,
  } as unknown as SuggestedContact;
}

function pair(
  id: string,
  a: SuggestedContact,
  b: SuggestedContact,
  confidence: number,
  extra: Partial<PersistedDedupeSuggestion> = {},
): PersistedDedupeSuggestion {
  return {
    id,
    contactIdA: a.id,
    contactIdB: b.id,
    contactA: a,
    contactB: b,
    matchType: "email",
    confidence,
    reasoning: "Same email address",
    caveat: null,
    matchedField: null,
    status: "pending",
    createdAt: "2026-10-05 10:00:00",
    reviewedAt: null,
    reviewedBy: null,
    ...extra,
  };
}

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

/**
 * The server, for the routes the list calls. A merge or a dismissal takes
 * the pairs it settled out of the pending list, so the list reads the
 * change back the way it does in the app.
 */
function stubApi(initial: PersistedDedupeSuggestion[]) {
  let pending = [...initial];
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.includes("/dedupe/suggestions?")) {
        return Response.json({ suggestions: pending, total: pending.length });
      }
      if (url.endsWith("/contacts/merge-cluster")) {
        const ids = [body.primaryId, ...body.duplicateIds];
        pending = pending.filter(
          (s) => !(ids.includes(s.contactIdA) && ids.includes(s.contactIdB)),
        );
        return Response.json({
          success: true,
          merged: body.duplicateIds.length,
          failed: 0,
          contact: null,
          mergeLogIds: body.duplicateIds.map((d: string) => `log-${d}`),
        });
      }
      if (url.endsWith("/dismiss")) {
        const id = url.split("/").at(-2);
        pending = pending.filter((s) => s.id !== id);
        return Response.json({ success: true });
      }
      return Response.json({ success: true, count: 0 });
    }),
  );
  return calls;
}

const merges = (calls: Call[]) =>
  calls.filter((c) => c.url.endsWith("/contacts/merge-cluster"));

function renderQueue() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DuplicateQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The options a toast was called with: its Undo is `action.onClick`. */
function lastUndo(spy: unknown): () => void {
  const calls = (spy as ReturnType<typeof vi.fn>).mock.calls;
  const options = calls.at(-1)?.[1] as { action?: { onClick: () => void } };
  if (!options?.action) throw new Error("The message offered no Undo");
  return options.action.onClick;
}

const ada = person("a", "Ada Quill", { company: "Northwind" });
const quill = person("b", "A. Quill");
const tobias = person("c", "Tobias Wren", { company: "Contoso" });
const wren = person("d", "T. Wren");

beforeEach(() => {
  wide = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the contact to keep", () => {
  it("moves with an arrow in its radio group, and that arrow merges nothing", async () => {
    const calls = stubApi([pair("ab", ada, quill, 0.95)]);
    renderQueue();
    const keep = await screen.findByRole("radiogroup", {
      name: "Contact to keep",
    });
    const chosen = within(keep).getByRole("radio", { checked: true });
    expect(chosen.textContent).toContain("Ada Quill");

    chosen.focus();
    fireEvent.keyDown(chosen, { key: "ArrowRight" });

    await waitFor(() =>
      expect(
        within(keep).getByRole("radio", { checked: true }).textContent,
      ).toContain("A. Quill"),
    );
    expect(merges(calls)).toEqual([]);
  });

  it("is the one a key merge keeps", async () => {
    const calls = stubApi([pair("ab", ada, quill, 0.95)]);
    renderQueue();
    const keep = await screen.findByRole("radiogroup", {
      name: "Contact to keep",
    });
    const other = within(keep).getByRole("radio", { name: /A\. Quill/ });
    fireEvent.click(other);
    other.focus();

    // From the radio itself: a letter is not the radio group's to keep.
    fireEvent.keyDown(other, { key: "l" });

    await waitFor(() => expect(merges(calls)).toHaveLength(1));
    expect(merges(calls)[0].body).toEqual({
      primaryId: "b",
      duplicateIds: ["a"],
    });
  });
});

describe("a held key", () => {
  it("decides once, though focus moves on to the next group", async () => {
    const calls = stubApi([
      pair("ab", ada, quill, 0.95),
      pair("cd", tobias, wren, 0.94),
    ]);
    renderQueue();
    await screen.findByRole("radiogroup", { name: "Contact to keep" });

    fireEvent.keyDown(document.body, { key: "l" });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Tobias Wren"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "l", repeat: true });

    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(merges(calls)).toHaveLength(1);
  });
});

describe("Different person", () => {
  it("keeps the open group and the contact chosen in it", async () => {
    const adaQ = person("e", "Ada Q.");
    stubApi([
      pair("ab", ada, quill, 0.95),
      pair("ae", ada, adaQ, 0.93),
      pair("be", quill, adaQ, 0.93),
      // First in the list before and after, so a lost place shows.
      pair("cd", tobias, wren, 0.97),
    ]);
    renderQueue();
    fireEvent.click(
      await screen.findByRole("button", { name: /Ada Quill and 2 others/ }),
    );
    const keep = () =>
      screen.getByRole("radiogroup", { name: "Contact to keep" });
    fireEvent.click(within(keep()).getByRole("radio", { name: /^A\. Quill/ }));

    fireEvent.click(
      screen.getByRole("button", { name: "Ada Q. is a different person" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Ada Quill and A. Quill",
        }),
      ).toBeTruthy(),
    );
    expect(
      within(keep()).getByRole("radio", { checked: true }).textContent,
    ).toContain("A. Quill");
  });
});

describe("Undo", () => {
  it("takes a merge back and puts the pair back in the list, without keeping them separate", async () => {
    const calls = stubApi([pair("ab", ada, quill, 0.95)]);
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: /^Merge/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe(
      "Merged A. Quill into Ada Quill",
    );

    await act(async () => lastUndo(toast.success)());

    const undo = calls.find((c) => c.url.includes("/merge-log/"));
    expect(undo?.url).toContain("/dedupe/merge-log/log-b/undo");
    expect(undo?.body).toEqual({ keepSeparate: false });
  });

  it("brings back each pair of a group kept separate", async () => {
    const calls = stubApi([pair("ab", ada, quill, 0.95)]);
    renderQueue();
    fireEvent.click(
      await screen.findByRole("button", { name: /Keep separate/ }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(vi.mocked(toast).mock.calls[0][0]).toBe(
      "Kept Ada Quill and A. Quill separate",
    );

    await act(async () => lastUndo(toast)());

    expect(
      calls.some((c) => c.url.endsWith("/dedupe/suggestions/ab/restore")),
    ).toBe(true);
  });

  it("is Z, for the last decision", async () => {
    const calls = stubApi([pair("ab", ada, quill, 0.95)]);
    renderQueue();
    await screen.findByRole("radiogroup", { name: "Contact to keep" });
    fireEvent.keyDown(document.body, { key: "h" });
    await waitFor(() => expect(toast).toHaveBeenCalled());

    fireEvent.keyDown(document.body, { key: "z" });

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/restore"))).toBe(true),
    );
  });
});

describe("the list", () => {
  it("shows the caveat on the row, before anything opens", async () => {
    wide = false;
    stubApi([
      pair("ab", ada, quill, 0.85, {
        matchType: "phone",
        reasoning: "Same phone number",
        caveat: "First names differ: Ada and Ben",
      }),
    ]);
    renderQueue();
    await screen.findByText("First names differ: Ada and Ben");
    screen.getByRole("heading", { name: /Check carefully/ });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("offers Merge all for Very likely only, never for a pair with a caveat", async () => {
    stubApi([
      pair("ab", ada, quill, 0.95),
      pair("cd", tobias, wren, 0.93),
      pair("ac", person("e", "Rowan Vale"), person("f", "R. Vale"), 0.85, {
        caveat: "Different companies and cities",
      }),
    ]);
    renderQueue();
    await screen.findByRole("button", { name: "Merge all 2" });
    expect(screen.getAllByRole("button", { name: /^Merge all/ })).toHaveLength(
      1,
    );
  });

  it("moves focus to the group that takes the decided one's place", async () => {
    stubApi([pair("ab", ada, quill, 0.95), pair("cd", tobias, wren, 0.94)]);
    renderQueue();
    await screen.findByRole("radiogroup", { name: "Contact to keep" });

    fireEvent.keyDown(document.body, { key: "l" });

    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Tobias Wren"),
    );
  });
});
