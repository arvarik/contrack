// @vitest-environment jsdom
// =============================================================================
// SearchView — a question stays attached to its own results
// =============================================================================
// Two defects, one cause. The view kept "the previous query" in a ref of its
// own, separate from the search state, so clearing the search left the ref
// behind and the same question was refused for ever. And the synthesis bar
// was handed the editable input rather than the question that produced the
// results, so typing question B and pressing Synthesize summarised A's
// contacts under B's words.
//
// Every test here drives the real view through the DOM, with `fetch` stubbed
// to answer NDJSON the way the server does. The request bodies are recorded,
// because "which question did the server receive" is the whole point.
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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "../../src/contexts/SessionContext";
import { PreferencesProvider } from "../../src/contexts/PreferencesContext";
import { SearchView } from "../../src/views/SearchView";
import { resetLastRecorded } from "../../src/api/searchHistory";

// The view reads one hook off the `api` barrel, and the barrel pulls in every
// API module in the app. Coverage instruments what is imported, so loading
// twenty modules this file never exercises dragged the project totals under
// their floors. The hook stays real, from its own file. The contact card and
// the result cards are stubbed for the same reason: what is under test is
// which question the server receives, and a card that shows a name is
// enough to see the results arrive.
vi.mock("../../src/api", async () => {
  const search = await import("../../src/api/search");
  return {
    useSemanticSearch: search.useSemanticSearch,
    useSearchCoverage: search.useSearchCoverage,
    useRefreshSearchIndex: search.useRefreshSearchIndex,
  };
});
vi.mock("../../src/views/search/SearchCoverageBar", () => ({
  SearchCoverageBar: () => null,
}));
vi.mock("../../src/views/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/views/search")>();
  return {
    ...actual,
    SearchCoverageBar: () => null,
  };
});
vi.mock("../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));
vi.mock("../../src/views/search/SearchResultCards", () => ({
  ResultCard: ({ match }: { match: { name: string } }) => (
    <div>{match.name}</div>
  ),
  ShimmerCard: () => null,
}));

function stubMatchMedia(wide = true) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: wide && query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

beforeEach(() => {
  stubMatchMedia(true);
  resetLastRecorded();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLastRecorded();
});

// Three, because the synthesis bar hides itself under three results.
const MATCHES = ["Ada Lovelace", "Grace Hopper", "Edsger Dijkstra"].map(
  (name, i) => ({ id: `contact-${i}`, name }),
);
const OTHER_MATCHES = ["Linus Torvalds", "Ken Thompson", "Dennis Ritchie"].map(
  (name, i) => ({ id: `other-${i}`, name }),
);

const line = (value: unknown) => JSON.stringify(value) + "\n";
const complete = (matches = MATCHES) =>
  line({ phase: "complete", matches, fallback: false });
/** A stream that ends before the server says it is done. */
const truncated = () =>
  line({ phase: "instant", matches: MATCHES, fallback: false });
const brief = () =>
  line({ phase: "complete", text: "Three people, one café." });

/** A response whose body is written by the test, one chunk at a time. */
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  };
}

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

const defaultPreferences = {
  theme: "system",
  accent: "#006a91",
  listDensity: "comfortable",
  recentLimit: 3,
  dedupePreset: "default",
  tempUnit: "celsius",
  searchHistory: [],
  askHistoryOpen: true,
};

const plainAnswers = (s: Sent) => {
  if (s.url.endsWith("/search/synthesize")) {
    return new Response(brief());
  }
  if (s.url.includes("/search/history")) {
    if (s.method === "POST") {
      return new Response(
        JSON.stringify({
          entry: {
            id: "hist-1",
            ownerId: "user-1",
            query: (s.body?.query as string) || "test",
            normalizedQuery: (
              (s.body?.query as string) || "test"
            ).toLowerCase(),
            mode: (s.body?.mode as string) || "people",
            resultCount: (s.body?.resultCount as number) || 0,
            resultIds: (s.body?.resultIds as string[]) || [],
            fallback: Boolean(s.body?.fallback),
            pinned: false,
            runCount: 1,
            createdAt: new Date().toISOString(),
            lastRunAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ entries: [], nextCursor: null, total: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (s.url.includes("/preferences")) {
    // The server answers a PATCH with the saved preferences, the patch in them.
    const preferences =
      s.method === "PATCH"
        ? { ...defaultPreferences, ...s.body }
        : defaultPreferences;
    return new Response(JSON.stringify({ preferences, stored: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (s.url.endsWith("/search/coverage")) {
    return new Response(
      JSON.stringify({ total: 10, indexed: 10, pending: 0, failed: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(complete());
};

/** Stub `fetch`, answer per request, and keep every body that was sent. */
function stubFetch(
  answer?: (sent: Sent, index: number) => Response | undefined,
) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const entry: Sent = {
        url,
        method: init?.method || "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      sent.push(entry);
      const customResponse = answer?.(entry, sent.length - 1);
      if (customResponse !== undefined) {
        return Promise.resolve(customResponse);
      }
      return Promise.resolve(plainAnswers(entry));
    }),
  );
  return sent;
}

const semantic = (sent: Sent[]) =>
  sent.filter((s) => s.url.endsWith("/search/semantic"));
const synthesize = (sent: Sent[]) =>
  sent.filter((s) => s.url.endsWith("/search/synthesize"));

const preferencePatches = (sent: Sent[]) =>
  sent.filter((s) => s.url.includes("/preferences") && s.method === "PATCH");

/** The history panel, from `lg`. */
const panel = () => document.getElementById("search-history");

/** A recorded People question, as the server lists it. */
const historyEntry = (id: string, query: string) => ({
  id,
  ownerId: "user-1",
  query,
  normalizedQuery: query.toLowerCase(),
  mode: "people" as const,
  resultCount: 1,
  resultIds: ["contact-1"],
  fallback: false,
  pinned: false,
  runCount: 1,
  createdAt: new Date().toISOString(),
  lastRunAt: new Date().toISOString(),
});

const historyList = (entries: ReturnType<typeof historyEntry>[]) =>
  new Response(
    JSON.stringify({ entries, nextCursor: null, total: entries.length }),
    { headers: { "Content-Type": "application/json" } },
  );

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function renderView(path = "/search") {
  return render(
    <QueryClientProvider client={client()}>
      <PreferencesProvider>
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <SearchView />
          </MemoryRouter>
        </SessionProvider>
      </PreferencesProvider>
    </QueryClientProvider>,
  );
}

const input = () =>
  screen.getByLabelText("Ask anything about your network") as HTMLInputElement;

function ask(question: string) {
  fireEvent.change(input(), { target: { value: question } });
  fireEvent.keyDown(input(), { key: "Enter" });
}

const QUESTION = "Who likes espresso?";

describe("asking the same question again", () => {
  it("runs the same question again after the search was cleared", async () => {
    const sent = stubFetch();
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");
    expect(semantic(sent)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input().value).toBe("");
    expect(screen.queryByText("Ada Lovelace")).toBeNull();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
  });

  it("runs the same question again after Escape cleared it", async () => {
    const sent = stubFetch();
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().value).toBe("");

    ask(QUESTION);
    await waitFor(() => expect(semantic(sent)).toHaveLength(2));
  });

  it("does not send the same question twice while it is being answered", async () => {
    const pending = stream();
    const sent = stubFetch((s) => {
      if (s.url.endsWith("/search/semantic")) {
        return pending.response;
      }
    });
    renderView();

    ask(QUESTION);
    await waitFor(() => expect(semantic(sent)).toHaveLength(1));
    expect(screen.getByText("Searching…")).toBeTruthy();

    // Enter again, twice, while the first answer is still streaming.
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(semantic(sent)).toHaveLength(1);

    await act(async () => {
      pending.push(complete());
      pending.end();
    });
    await screen.findByText("Ada Lovelace");
  });

  it("offers Retry after a failed search, and Retry sends the question again", async () => {
    let semanticCalls = 0;
    const sent = stubFetch((s) => {
      if (s.url.endsWith("/search/semantic")) {
        semanticCalls++;
        return semanticCalls === 1 ? new Response(truncated()) : undefined;
      }
    });
    renderView();

    ask(QUESTION);
    await screen.findByText("Search failed");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Ada Lovelace");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
  });

  it("offers Refresh beside the results, which re-asks the answered question", async () => {
    let semanticCalls = 0;
    const sent = stubFetch((s) => {
      if (s.url.endsWith("/search/semantic")) {
        semanticCalls++;
        return semanticCalls === 1
          ? new Response(complete())
          : new Response(complete(OTHER_MATCHES));
      }
    });
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");

    // Whatever is in the input, Refresh re-asks the question the results
    // belong to.
    fireEvent.change(input(), { target: { value: "something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));

    await screen.findByText("Linus Torvalds");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
  });
});

describe("the question the results belong to", () => {
  it("synthesises the answered question, not whatever is being typed", async () => {
    const sent = stubFetch();
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");

    // Type question B without submitting it. The results on screen are A's.
    fireEvent.change(input(), { target: { value: "Who works in London?" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Synthesize these results/ }),
    );

    await waitFor(() => expect(synthesize(sent)).toHaveLength(1));
    expect(synthesize(sent)[0].body).toEqual({
      query: QUESTION,
      contactIds: MATCHES.map((m) => m.id),
    });
    await screen.findByText("Three people, one café.");
  });

  it("records the question a ?q= link asked, so the view restores it", async () => {
    stubFetch();
    const queryClient = client();
    const Harness = ({ mounted }: { mounted: boolean }) => (
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <SessionProvider>
            <MemoryRouter
              initialEntries={[`/search?q=${encodeURIComponent(QUESTION)}`]}
            >
              {mounted && <SearchView />}
            </MemoryRouter>
          </SessionProvider>
        </PreferencesProvider>
      </QueryClientProvider>
    );

    const view = render(<Harness mounted />);
    await screen.findByText("Ada Lovelace");

    // Leave the page and come back. The session keeps the results, and it
    // must keep the question that produced them beside them.
    view.rerender(<Harness mounted={false} />);
    view.rerender(<Harness mounted />);
    expect(input().value).toBe(QUESTION);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });
});

describe("the history", () => {
  it("posts to /api/search/history exactly once after a completed search with the right body", async () => {
    const sent = stubFetch();
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");

    await waitFor(() => {
      const posts = sent.filter(
        (s) => s.url.includes("/search/history") && s.method === "POST",
      );
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        query: QUESTION,
        mode: "people",
        resultCount: MATCHES.length,
        resultIds: MATCHES.map((m) => m.id),
        fallback: false,
      });
    });
  });

  it("re-runs the search when clicking a fetched history entry", async () => {
    const sent = stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        return historyList([historyEntry("hist-123", "Who knows Python?")]);
      }
    });

    renderView();
    const entryButton = await screen.findByRole("button", {
      name: /Who knows Python\?/i,
    });
    fireEvent.click(entryButton);

    expect(input().value).toBe("Who knows Python?");
    await waitFor(() => {
      const calls = semantic(sent);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[calls.length - 1].body).toEqual({
        query: "Who knows Python?",
      });
    });
  });

  it("narrows the visible list when typing into the history filter", async () => {
    const entries = [
      historyEntry("hist-1", "Who knows Python?"),
      historyEntry("hist-2", "Who likes green tea?"),
    ];

    stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        const url = new URL(s.url, "http://localhost");
        const qParam = url.searchParams.get("q")?.toLowerCase();
        const filtered = qParam
          ? entries.filter((e) => e.normalizedQuery.includes(qParam))
          : entries;
        return historyList(filtered);
      }
    });

    renderView();
    const panel = await screen.findByRole("complementary", { name: "History" });
    await within(panel).findByText("Who knows Python?");
    expect(within(panel).getByText("Who likes green tea?")).toBeTruthy();

    const filterInput = within(panel).getByLabelText("Filter history");
    fireEvent.change(filterInput, { target: { value: "tea" } });

    await waitFor(() => {
      expect(within(panel).queryByText("Who knows Python?")).toBeNull();
      expect(within(panel).getByText("Who likes green tea?")).toBeTruthy();
    });
  });

  it("puts the count and Clear in the panel's heading row, and draws no heading of its own", async () => {
    stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        return historyList([historyEntry("hist-1", "Who knows Python?")]);
      }
    });
    renderView();

    const panel = await screen.findByRole("complementary", { name: "History" });
    await within(panel).findByText("Who knows Python?");
    // One heading, the panel's. The pane's own heading row is the sheet's.
    const headings = within(panel).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["History"]);
    expect(within(panel).getByText("1")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(
      within(panel).queryByRole("button", { name: "Close history" }),
    ).toBeNull();
  });

  it("clears the history from the heading row's Clear, after asking", async () => {
    const sent = stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        return historyList([historyEntry("hist-1", "Who knows Python?")]);
      }
    });
    renderView();

    const panel = await screen.findByRole("complementary", { name: "History" });
    await within(panel).findByText("Who knows Python?");
    fireEvent.click(within(panel).getByRole("button", { name: "Clear" }));

    // It asks first, and a cancel sends nothing.
    const dialog = await screen.findByRole("dialog", {
      name: "Clear search history?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Clear search history?" }),
      ).toBeNull(),
    );
    const deletes = () =>
      sent.filter(
        (s) => s.url.includes("/search/history") && s.method === "DELETE",
      );
    expect(deletes()).toHaveLength(0);

    fireEvent.click(within(panel).getByRole("button", { name: "Clear" }));
    const again = await screen.findByRole("dialog", {
      name: "Clear search history?",
    });
    fireEvent.click(
      within(again).getByRole("button", { name: "Clear history" }),
    );
    await waitFor(() => expect(deletes()).toHaveLength(1));
  });

  it("opens and closes from the rail icon, the one History control on a wide screen", async () => {
    const sent = stubFetch();
    renderView();

    // A disclosure for the panel. The page header has no History button.
    const icon = await screen.findByRole("button", { name: "History" });
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    expect(icon.getAttribute("aria-controls")).toBe("search-history");
    expect(icon.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(icon);

    await waitFor(() => expect(preferencePatches(sent)).toHaveLength(1));
    expect(preferencePatches(sent)[0].body).toEqual({ askHistoryOpen: false });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(panel()?.hasAttribute("inert")).toBe(true);
  });

  it("hides from the panel's own button, and hands focus to the rail icon", async () => {
    const sent = stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", { name: "History" });
    const hide = within(aside).getByRole("button", { name: "Hide history" });
    // The shortcut that also toggles the panel is in the tooltip.
    expect(hide.getAttribute("title")).toBe("Hide history (H)");
    // A press focuses the button in a browser. jsdom's click does not.
    hide.focus();
    fireEvent.click(hide);

    await waitFor(() => expect(preferencePatches(sent)).toHaveLength(1));
    expect(preferencePatches(sent)[0].body).toEqual({ askHistoryOpen: false });
    expect(panel()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "History" }),
    );
  });

  it("toggles the panel with the H key outside a text field", async () => {
    const sent = stubFetch();
    renderView();

    const icon = await screen.findByRole("button", { name: "History" });
    // The box has focus on arrival, and an h typed there is a letter.
    input().blur();
    fireEvent.keyDown(document.body, { key: "h" });

    await waitFor(() =>
      expect(icon.getAttribute("aria-expanded")).toBe("false"),
    );
    await waitFor(() => expect(preferencePatches(sent)).toHaveLength(1));
    expect(preferencePatches(sent)[0].body).toEqual({ askHistoryOpen: false });
  });

  it("hands focus to the rail icon when H closes the panel from inside it", async () => {
    stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", { name: "History" });
    const inside = within(aside).getByRole("button", { name: "Hide history" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "h" });

    const icon = screen.getByRole("button", { name: "History" });
    await waitFor(() =>
      expect(icon.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(document.activeElement).toBe(icon);
  });

  it("clears the filter on Escape before Escape hides the panel", async () => {
    stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", { name: "History" });
    const filter = within(aside).getByLabelText(
      "Filter history",
    ) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "tea" } });
    filter.focus();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter.value).toBe("");
    expect(panel()?.hasAttribute("inert")).toBe(false);

    fireEvent.keyDown(filter, { key: "Escape" });
    await waitFor(() => expect(panel()?.hasAttribute("inert")).toBe(true));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "History" }),
    );
  });

  it("opens the sheet from the header below lg, where the sheet's own close control is the way out", async () => {
    stubMatchMedia(false);
    stubFetch();
    renderView();

    // No rail below lg: the header's button opens a sheet.
    const button = await screen.findByRole("button", { name: "History" });
    expect(panel()).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(button);

    // The sheet draws the heading row itself, with a visible X.
    const sheet = await screen.findByRole("dialog", { name: "Search history" });
    expect(
      within(sheet).getByRole("heading", { name: "History" }),
    ).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", { name: "Hide history" }),
    ).toBeNull();
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Close history" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Search history" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(button);

    // H opens it again.
    fireEvent.keyDown(button, { key: "h" });
    expect(
      await screen.findByRole("dialog", { name: "Search history" }),
    ).toBeTruthy();
  });
});

describe("the page", () => {
  it("is the title, the mode switch and the search box: no description", async () => {
    stubFetch();
    renderView();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Ask Contrack" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("Ask a question about your network in plain words"),
    ).toBeNull();
    expect(input()).toBeTruthy();
  });

  it("fills the box and asks when a suggested question is pressed", async () => {
    const sent = stubFetch();
    renderView();

    const list = await screen.findByRole("list", { name: "Try asking" });
    const suggestion = within(list).getByRole("button", {
      name: "Who likes espresso?",
    });
    // The words and nothing else: no glyph before them.
    expect(suggestion.textContent).toBe("Who likes espresso?");
    fireEvent.click(suggestion);

    expect(input().value).toBe("Who likes espresso?");
    await waitFor(() =>
      expect(semantic(sent)[0]?.body).toEqual({
        query: "Who likes espresso?",
      }),
    );
  });

  it("says no one matches in one sentence, with nothing inside it", async () => {
    stubFetch((s) => {
      if (s.url.endsWith("/search/semantic")) {
        return new Response(complete([]));
      }
    });
    renderView();

    ask(QUESTION);
    const heading = await screen.findByRole("heading", {
      name: "No one matches",
    });
    const state = heading.parentElement as HTMLElement;
    expect(within(state).getByText("Try other words.")).toBeTruthy();
    expect(within(state).queryByRole("button")).toBeNull();
  });
});
