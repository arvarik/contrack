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
    expect(screen.getByText("Searching...")).toBeTruthy();

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

describe("the history pane", () => {
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
    const fakeEntry = {
      id: "hist-123",
      ownerId: "user-1",
      query: "Who knows Python?",
      normalizedQuery: "who knows python?",
      mode: "people" as const,
      resultCount: 2,
      resultIds: ["contact-1", "contact-2"],
      fallback: false,
      pinned: false,
      runCount: 1,
      createdAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
    };

    const sent = stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        return new Response(
          JSON.stringify({
            entries: [fakeEntry],
            nextCursor: null,
            total: 1,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
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
      {
        id: "hist-1",
        ownerId: "user-1",
        query: "Who knows Python?",
        normalizedQuery: "who knows python?",
        mode: "people" as const,
        resultCount: 1,
        resultIds: ["contact-1"],
        fallback: false,
        pinned: false,
        runCount: 1,
        createdAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
      },
      {
        id: "hist-2",
        ownerId: "user-1",
        query: "Who likes green tea?",
        normalizedQuery: "who likes green tea?",
        mode: "people" as const,
        resultCount: 1,
        resultIds: ["contact-2"],
        fallback: false,
        pinned: false,
        runCount: 1,
        createdAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
      },
    ];

    stubFetch((s) => {
      if (s.url.includes("/search/history") && s.method === "GET") {
        const url = new URL(s.url, "http://localhost");
        const qParam = url.searchParams.get("q")?.toLowerCase();
        const filtered = qParam
          ? entries.filter((e) => e.normalizedQuery.includes(qParam))
          : entries;
        return new Response(
          JSON.stringify({
            entries: filtered,
            nextCursor: null,
            total: filtered.length,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
    });

    renderView();
    const historyAside = await screen.findByRole("complementary", {
      name: "Search history",
    });
    await within(historyAside).findByText("Who knows Python?");
    expect(within(historyAside).getByText("Who likes green tea?")).toBeTruthy();

    const filterInput = within(historyAside).getByLabelText("Filter history");
    fireEvent.change(filterInput, { target: { value: "tea" } });

    await waitFor(() => {
      expect(within(historyAside).queryByText("Who knows Python?")).toBeNull();
      expect(
        within(historyAside).getByText("Who likes green tea?"),
      ).toBeTruthy();
    });
  });

  it("writes askHistoryOpen preference when clicking the history toggle button on desktop", async () => {
    stubMatchMedia(true);
    const sent = stubFetch();
    renderView();

    // The pane is open, so the toggle is pressed. Its name stays "History"
    // in both states: the pressed state says open or closed.
    const toggleButton = await screen.findByRole("button", {
      name: "History",
      pressed: true,
    });
    expect(toggleButton.getAttribute("aria-controls")).toBe(
      "search-history-aside",
    );
    expect(toggleButton.getAttribute("title")).toBe("History (H)");
    fireEvent.click(toggleButton);

    await waitFor(() => {
      const patches = sent.filter(
        (s) => s.url.includes("/preferences") && s.method === "PATCH",
      );
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toEqual({ askHistoryOpen: false });
    });

    // Closed: the same button opens it again, and controls nothing on the page.
    const reopen = await screen.findByRole("button", {
      name: "History",
      pressed: false,
    });
    expect(reopen).toBe(toggleButton);
    expect(reopen.hasAttribute("aria-controls")).toBe(false);
    expect(
      screen.queryByRole("complementary", { name: "Search history" }),
    ).toBeNull();
  });

  it("hides the pane from the button in its own header, and hands focus to the header toggle", async () => {
    stubMatchMedia(true);
    const sent = stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", {
      name: "Search history",
    });
    const hide = within(aside).getByRole("button", { name: "Hide history" });
    // The shortcut that also toggles the pane is in the tooltip.
    expect(hide.getAttribute("title")).toBe("Hide history (H)");
    fireEvent.click(hide);

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Search history" }),
      ).toBeNull(),
    );
    // The button that was pressed is gone, and the keyboard is on the one
    // that brings the pane back.
    const toggle = screen.getByRole("button", {
      name: "History",
      pressed: false,
    });
    expect(document.activeElement).toBe(toggle);
    await waitFor(() => {
      const patches = sent.filter(
        (s) => s.url.includes("/preferences") && s.method === "PATCH",
      );
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toEqual({ askHistoryOpen: false });
    });
  });

  it("toggles the pane with the H key outside a text field", async () => {
    stubMatchMedia(true);
    const sent = stubFetch();
    renderView();

    await screen.findByRole("complementary", { name: "Search history" });
    // The box has focus on arrival, and an h typed there is a letter.
    input().blur();
    fireEvent.keyDown(document.body, { key: "h" });

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Search history" }),
      ).toBeNull(),
    );
    await waitFor(() => {
      const patches = sent.filter(
        (s) => s.url.includes("/preferences") && s.method === "PATCH",
      );
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toEqual({ askHistoryOpen: false });
    });
  });

  it("hands focus to the header toggle when H closes the pane from inside it", async () => {
    stubMatchMedia(true);
    stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", {
      name: "Search history",
    });
    const inside = within(aside).getByRole("button", { name: "Hide history" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "h" });

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Search history" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "History", pressed: false }),
    );
  });

  it("opens the history sheet from the toggle on a phone, where the sheet's own close control is the way out", async () => {
    stubMatchMedia(false);
    stubFetch();
    renderView();

    const toggle = await screen.findByRole("button", { name: "History" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-haspopup")).toBe("dialog");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(toggle);

    const sheet = await screen.findByRole("dialog", { name: "Search history" });
    expect(
      within(sheet).queryByRole("button", { name: "Hide history" }),
    ).toBeNull();
    // The sheet closes from a visible X in the pane's header, and the
    // keyboard goes back to the toggle.
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Close history" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Search history" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(toggle);
  });
});

describe("the page", () => {
  it("is the title, its two controls and the search box: no description", async () => {
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
