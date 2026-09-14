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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "../../src/contexts/SessionContext";
import { SearchView } from "../../src/views/SearchView";

// The view reads one hook off the `api` barrel, and the barrel pulls in every
// API module in the app. Coverage instruments what is imported, so loading
// twenty modules this file never exercises dragged the project totals under
// their floors. The hook stays real, from its own file. The contact card and
// the result cards are stubbed for the same reason: what is under test is
// which question the server receives, and a card that shows a name is
// enough to see the results arrive.
vi.mock("../../src/api", async () => ({
  useSemanticSearch: (await import("../../src/api/search")).useSemanticSearch,
}));
vi.mock("../../src/components/FloatingContactCard", () => ({
  FloatingContactCard: () => null,
}));
vi.mock("../../src/views/search/SearchResultCards", () => ({
  ResultCard: ({ match }: { match: { name: string } }) => (
    <div>{match.name}</div>
  ),
  ShimmerCard: () => null,
}));

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
  body: Record<string, unknown> | undefined;
}

/** Stub `fetch`, answer per request, and keep every body that was sent. */
function stubFetch(answer: (sent: Sent, index: number) => Response) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const entry: Sent = {
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      sent.push(entry);
      return Promise.resolve(answer(entry, sent.length - 1));
    }),
  );
  return sent;
}

const semantic = (sent: Sent[]) =>
  sent.filter((s) => s.url.endsWith("/search/semantic"));
const synthesize = (sent: Sent[]) =>
  sent.filter((s) => s.url.endsWith("/search/synthesize"));

/** Answers every search with the same three people and every brief the same. */
const plainAnswers = (s: Sent) =>
  s.url.endsWith("/search/synthesize")
    ? new Response(brief())
    : new Response(complete());

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function renderView(path = "/search") {
  return render(
    <QueryClientProvider client={client()}>
      <SessionProvider>
        <MemoryRouter initialEntries={[path]}>
          <SearchView />
        </MemoryRouter>
      </SessionProvider>
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
    const sent = stubFetch(plainAnswers);
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
    const sent = stubFetch(plainAnswers);
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
    const sent = stubFetch(() => pending.response);
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
    const sent = stubFetch((s, index) =>
      index === 0 ? new Response(truncated()) : plainAnswers(s),
    );
    renderView();

    ask(QUESTION);
    await screen.findByText("Search failed");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Ada Lovelace");
    expect(semantic(sent)).toHaveLength(2);
    expect(semantic(sent)[1].body).toEqual({ query: QUESTION });
  });

  it("offers Refresh beside the results, which re-asks the answered question", async () => {
    const sent = stubFetch((s, index) =>
      index === 0
        ? new Response(complete())
        : new Response(complete(OTHER_MATCHES)),
    );
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
    const sent = stubFetch(plainAnswers);
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
    stubFetch(plainAnswers);
    const queryClient = client();
    const Harness = ({ mounted }: { mounted: boolean }) => (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <MemoryRouter
            initialEntries={[`/search?q=${encodeURIComponent(QUESTION)}`]}
          >
            {mounted && <SearchView />}
          </MemoryRouter>
        </SessionProvider>
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
