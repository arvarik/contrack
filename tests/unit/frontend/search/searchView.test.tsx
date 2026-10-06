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
import { SessionProvider } from "../../../../src/contexts/SessionContext";
import { PreferencesProvider } from "../../../../src/contexts/PreferencesContext";
import { SearchView } from "../../../../src/views/SearchView";

// The page reads its search hooks off the `api` barrel, and the barrel pulls
// in every API module in the app. Coverage instruments what is imported, so
// loading twenty modules this file never exercises dragged the project
// totals under their floors. The hooks stay real, from their own file. The contact card and
// the result cards are stubbed for the same reason: what is under test is
// which question the server receives, and a card that shows a name is
// enough to see the results arrive.
vi.mock("../../../../src/api", async () => {
  const search = await import("../../../../src/api/search");
  return {
    useSearchCoverage: search.useSearchCoverage,
    useRefreshSearchIndex: search.useRefreshSearchIndex,
    useStarterQuestions: search.useStarterQuestions,
  };
});
vi.mock("../../../../src/views/search/SearchCoverageBar", () => ({
  SearchCoverageBar: () => null,
}));
vi.mock("../../../../src/views/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/views/search")>();
  return {
    ...actual,
    SearchCoverageBar: () => null,
  };
});
vi.mock("../../../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));
vi.mock("../../../../src/views/search/SearchResultCards", () => ({
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Three, because the synthesis bar hides itself under three results.
const MATCHES = ["Ada Lovelace", "Grace Hopper", "Edsger Dijkstra"].map(
  (name, i) => ({ id: `contact-${i}`, name }),
);
const OTHER_MATCHES = ["Linus Torvalds", "Ken Thompson", "Dennis Ritchie"].map(
  (name, i) => ({ id: `other-${i}`, name }),
);

const line = (value: unknown) => JSON.stringify(value) + "\n";
const complete = (matches = MATCHES, fallback = false) =>
  line({ phase: "complete", matches, fallback });

/** The account's starter questions, as `/search/starters` answers. */
const POOL = [
  { kind: "industry", text: "Who works in Fintech?" },
  { kind: "industry", text: "Who works in Media?" },
  { kind: "industry", text: "Who works in Robotics?" },
  { kind: "city", text: "Who do I know in Lisbon?" },
  { kind: "city", text: "Who do I know in Austin?" },
  { kind: "company", text: "Who works at Northwind Logistics?" },
  { kind: "interest", text: "Who is interested in Espresso?" },
  { kind: "role", text: "Who works as a CTO?" },
];
let starterPool: typeof POOL = POOL;
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
  if (s.url.endsWith("/search/starters")) {
    return new Response(JSON.stringify({ questions: starterPool }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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

/** The Ask page under one session, which a test can leave and come back to. */
function leavablePage(path = "/search") {
  const queryClient = client();
  const Harness = ({ mounted }: { mounted: boolean }) => (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            {mounted && <SearchView />}
          </MemoryRouter>
        </SessionProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
  const view = render(<Harness mounted />);
  return {
    leave: () => view.rerender(<Harness mounted={false} />),
    back: () => view.rerender(<Harness mounted />),
  };
}

const input = () =>
  screen.getByLabelText("Ask about your network") as HTMLInputElement;

function ask(question: string) {
  fireEvent.change(input(), { target: { value: question } });
  fireEvent.keyDown(input(), { key: "Enter" });
}

const QUESTION = "Who likes espresso?";

describe("asking the same question again", () => {
  it.each([
    [
      "the Clear button",
      () =>
        fireEvent.click(screen.getByRole("button", { name: "Clear search" })),
    ],
    ["Escape", () => fireEvent.keyDown(input(), { key: "Escape" })],
  ])(
    "runs the same question again after %s cleared it",
    async (_how, clear) => {
      const sent = stubFetch();
      renderView();

      ask(QUESTION);
      await screen.findByText("Ada Lovelace");
      expect(semantic(sent)).toHaveLength(1);

      clear();
      expect(input().value).toBe("");
      expect(screen.queryByText("Ada Lovelace")).toBeNull();

      ask(QUESTION);
      await screen.findByText("Ada Lovelace");
      expect(semantic(sent)).toHaveLength(2);
      expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
    },
  );

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
    expect(await screen.findByText("Searching your network…")).toBeTruthy();

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
    await screen.findByText("Could not search");
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Refresh results" }),
    ).toBeNull();

    // Retry asks the question that failed, not whatever is typed by now.
    fireEvent.change(input(), { target: { value: "something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Ada Lovelace");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
  });

  it("has no Refresh beside a list AI checked: asking again showed the same list", async () => {
    stubFetch();
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask AI again" })).toBeNull();
  });

  it("offers Ask AI again beside a list AI could not check, for the answered question", async () => {
    let semanticCalls = 0;
    const sent = stubFetch((s) => {
      if (s.url.endsWith("/search/semantic")) {
        semanticCalls++;
        return semanticCalls === 1
          ? new Response(complete(MATCHES, true))
          : new Response(complete(OTHER_MATCHES));
      }
    });
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");

    // Whatever is in the input, it asks the question the results belong to.
    fireEvent.change(input(), { target: { value: "something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI again" }));

    await screen.findByText("Linus Torvalds");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
    // AI checked the second answer: nothing to ask again.
    expect(screen.queryByRole("button", { name: "Ask AI again" })).toBeNull();
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
    // The "Summary status" live region holds the same text once it is final.
    await screen.findByText("Three people, one café.", { selector: "p" });
  });

  it("records the question a ?q= link asked, so the view restores it", async () => {
    stubFetch();
    const page = leavablePage(`/search?q=${encodeURIComponent(QUESTION)}`);
    await screen.findByText("Ada Lovelace");

    // Leave the page and come back. The session keeps the results, and it
    // must keep the question that produced them beside them.
    page.leave();
    page.back();
    expect(input().value).toBe(QUESTION);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("keeps answering a question after the page is left, and shows the answer on return", async () => {
    const answer = stream();
    stubFetch((s) =>
      s.url.endsWith("/search/semantic") ? answer.response : undefined,
    );
    const page = leavablePage();
    ask(QUESTION);
    page.leave();
    await act(async () => {
      answer.push(complete());
      answer.end();
    });
    page.back();
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  });
});

describe("the history", () => {
  it("posts to /api/search/history exactly once after a completed search with the right body", async () => {
    // A question no other test asks: the client records a question once in
    // two seconds, and the tests above ask QUESTION within that time.
    const question = "Who roasts their own coffee?";
    const sent = stubFetch();
    renderView();

    ask(question);
    await screen.findByText("Ada Lovelace");

    await waitFor(() => {
      const posts = sent.filter(
        (s) => s.url.includes("/search/history") && s.method === "POST",
      );
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        query: question,
        mode: "people",
        resultCount: MATCHES.length,
        resultIds: MATCHES.map((m) => m.id),
        fallback: false,
      });
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

  it("opens and closes from the rail icon, the one History control on a wide screen", async () => {
    const sent = stubFetch();
    renderView();

    // A disclosure for the panel. The page header has no History button,
    // and the panel has no second close button.
    const icon = await screen.findByRole("button", { name: "History" });
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    expect(icon.getAttribute("aria-controls")).toBe("search-history");
    expect(icon.hasAttribute("aria-pressed")).toBe(false);
    const aside = screen.getByRole("complementary", { name: "History" });
    expect(within(aside).queryByRole("button", { name: /hide/i })).toBeNull();
    // A press focuses the button in a browser. jsdom's click does not.
    icon.focus();
    fireEvent.click(icon);

    await waitFor(() => expect(preferencePatches(sent)).toHaveLength(1));
    expect(preferencePatches(sent)[0].body).toEqual({ askHistoryOpen: false });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(panel()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(icon);
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

  it("hands focus to the History button when H closes the panel from inside it", async () => {
    stubFetch();
    renderView();

    const aside = await screen.findByRole("complementary", { name: "History" });
    const inside = within(aside).getByRole("radio", { name: "All" });
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
});

describe("the wait for AI", () => {
  it("says once, over the list, when AI did not verify the answer", async () => {
    stubFetch((s) => {
      if (s.url.endsWith("/search/semantic"))
        return new Response(
          line({ phase: "complete", matches: MATCHES, fallback: true }),
        );
    });
    renderView();

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Not verified by AI")).toBeTruthy();
    const why = screen.getByRole("button", {
      name: "Why these results are not verified by AI",
    });
    fireEvent.click(why);
    expect(screen.getByRole("tooltip").textContent).toMatch(
      /They match your words or their meaning/,
    );
  });
});

describe("the page", () => {
  it("is the title, the mode switch and the search box: no description", async () => {
    stubFetch();
    renderView();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Ask Contrack" }),
    ).toBeTruthy();
    const modes = screen.getByRole("radiogroup", { name: "What to search" });
    expect(
      within(modes)
        .getByRole("radio", { name: "People" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.queryByText("Ask a question about your network in plain words"),
    ).toBeNull();
    expect(input()).toBeTruthy();
  });

  it("fills the box and asks when a suggested question is pressed", async () => {
    const sent = stubFetch();
    renderView();

    const list = await screen.findByRole("list", { name: "Try asking" });
    const [suggestion] = within(list).getAllByRole("button");
    const question = suggestion!.textContent!;
    // The words and nothing else: no glyph before them.
    expect(POOL.map((q) => q.text)).toContain(question);
    fireEvent.click(suggestion!);

    expect(input().value).toBe(question);
    await waitFor(() =>
      expect(semantic(sent)[0]?.body).toEqual({ query: question }),
    );
  });

  it("shows six questions from the account's pool, and a new draw after Clear", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    stubFetch();
    renderView();

    const chips = async () =>
      within(await screen.findByRole("list", { name: "Try asking" }))
        .getAllByRole("button")
        .map((chip) => chip.textContent);
    const first = await chips();
    expect(first).toHaveLength(6);
    for (const text of first) expect(POOL.map((q) => q.text)).toContain(text);
    // The draw picks kinds first: five kinds and six places, so every kind
    // is in it, and the sixth question comes from a kind with more.
    const kindOf = (text: string | null) =>
      POOL.find((q) => q.text === text)?.kind;
    expect(new Set(first.map(kindOf)).size).toBe(5);

    ask(QUESTION);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("list", { name: "Try asking" })).toBeNull();

    random.mockReturnValue(0.99);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    const second = await chips();
    expect(second).toHaveLength(6);
    expect(second).not.toEqual(first);
    random.mockRestore();
  });

  it("counts every match of a question of facets, links the rest and the map, and saves the count", async () => {
    // The server names the Network query only when the list can read it.
    const sent = stubFetch((s) => {
      const asked = String(s.body?.query);
      if (s.url.endsWith("/search/semantic"))
        return new Response(
          line({
            phase: "complete",
            matches: MATCHES,
            fallback: false,
            total: asked === "tag:rare" ? MATCHES.length : 1501,
            ...(asked.startsWith("tag:") ? { facets: asked } : {}),
          }),
        );
    });
    renderView();
    const seeAll = () =>
      screen.queryByRole("link", { name: "See all in Network" });
    const onMap = () =>
      screen.getByRole("link", { name: "Show on map" }).getAttribute("href");

    ask("tag:investor");
    expect(await screen.findByText("3 of 1,501 matches")).toBeTruthy();
    expect(seeAll()?.getAttribute("href")).toBe("/?q=tag%3Ainvestor");
    // The map shows every match of facets, and else the people listed.
    expect(onMap()).toBe("/map?q=tag%3Ainvestor");
    await waitFor(() =>
      expect(
        sent.find((s) => s.url.includes("/search/history") && s.body)?.body,
      ).toMatchObject({ query: "tag:investor", resultCount: 1501 }),
    );

    // The history records an answer once it has landed.
    ask("near:Paris");
    await waitFor(() =>
      expect(
        sent.some(
          (s) =>
            s.url.includes("/search/history") && s.body?.query === "near:Paris",
        ),
      ).toBe(true),
    );
    expect(screen.getByText("3 of 1,501 matches")).toBeTruthy();
    expect(seeAll()).toBeNull();
    expect(onMap()).toBe("/map?people=contact-0,contact-1,contact-2");

    // A list that holds every match has nothing more to open.
    ask("tag:rare");
    expect(await screen.findByText("3 matches")).toBeTruthy();
    expect(seeAll()).toBeNull();
  });

  it("offers the facets that narrow a long list, and a press asks again with one added", async () => {
    const refine = [
      { facet: "industry:Fintech", label: "Fintech", count: 412 },
      { facet: 'location:"New York"', label: "New York", count: 1203 },
    ];
    const sent = stubFetch((s) => {
      if (s.url.endsWith("/search/semantic"))
        return new Response(
          line({
            phase: "complete",
            matches: MATCHES,
            fallback: false,
            total: 1501,
            // The narrowed answer is short, so it offers nothing more.
            ...(s.body?.query === "Who do I track?" ? { refine } : {}),
          }),
        );
    });
    renderView();

    ask("Who do I track?");
    const group = await screen.findByRole("group", { name: "Narrow the list" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Narrow to Fintech, 412 people",
      "Narrow to New York, 1,203 people",
    ]);
    expect(chips[1]!.textContent).toBe("New York1,203");

    fireEvent.click(chips[1]!);
    const narrowed = 'Who do I track? location:"New York"';
    expect(input().value).toBe(narrowed);
    await waitFor(() =>
      expect(semantic(sent).at(-1)?.body).toEqual({ query: narrowed }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "Narrow the list" }),
      ).toBeNull(),
    );
  });

  it("shows no Try asking for an account with nothing to ask about", async () => {
    starterPool = [];
    stubFetch();
    renderView();

    await screen.findByRole("heading", { level: 1, name: "Ask Contrack" });
    await waitFor(() => expect(input()).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Try asking" })).toBeNull();
    starterPool = POOL;
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
    expect(within(state).getByText("Try other words")).toBeTruthy();
    expect(within(state).queryByRole("button")).toBeNull();
  });
});
