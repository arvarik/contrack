// @vitest-environment jsdom
// =============================================================================
// InteractionSearchPanel — what it asks the server, and what it shows back
// =============================================================================
// The panel is driven through the DOM with `fetch` stubbed to answer the way
// GET /api/search/interactions does. The requests are recorded, because
// "which question, which period and which zone reached the server" is the
// contract, and the highlight ranges the server sends back have to land on
// the right letters.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Highlighted,
  InteractionSearchPanel,
} from "../../src/views/search/InteractionSearchPanel";
import type { InteractionSearchResult } from "../../src/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const HIT: InteractionSearchResult["hits"][number] = {
  id: "note-1",
  contactId: "contact-1",
  type: "meeting",
  title: "Coffee with Sam",
  date: "2026-08-12T10:00:00.000Z",
  excerpt: "We discussed hiring plans for the Berlin office.",
  highlights: { title: [], excerpt: [[13, 19]] },
  contact: {
    id: "contact-1",
    name: "Sam Rivera",
    avatarUrl: null,
    themeColor: "brand",
    company: "Acme",
    role: "CTO",
  },
};

function answer(overrides: Partial<InteractionSearchResult> = {}) {
  const body: InteractionSearchResult = {
    query: {
      text: "hiring",
      tokens: ["hiring"],
      mode: "all",
      phrase: "last month",
      range: {
        from: "2026-08-01T07:00:00.000Z",
        to: "2026-09-01T07:00:00.000Z",
        source: "phrase",
      },
      timeZone: "America/Los_Angeles",
    },
    total: 1,
    limit: 20,
    offset: 0,
    hits: [HIT],
    ...overrides,
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stub `fetch`, answer every request the same way, and keep the URL of every
 * note search. The question a search records in the history is a request
 * too, and it is left out of the list.
 */
function stubFetch(reply: () => Response = answer) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/search/interactions")) urls.push(url);
      return Promise.resolve(reply());
    }),
  );
  return urls;
}

function mount(initialUrl = "/search?mode=notes") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/search" element={<InteractionSearchPanel />} />
          <Route path="/contact/:id" element={<div>contact page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const params = (url: string) => new URL(url, "http://localhost").searchParams;

describe("InteractionSearchPanel", () => {
  it("searches when Search is pressed, not while the words are typed", async () => {
    const urls = stubFetch();
    mount();
    fireEvent.change(screen.getByLabelText("Search your notes"), {
      target: { value: "hiring" },
    });
    // Typing alone sends nothing: the box searches on Enter or Search, as
    // People's does.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(params(urls[0]).get("q")).toBe("hiring");
  });

  it("sends the question, the reader's zone and the page size", async () => {
    const urls = stubFetch();
    mount();
    const box = screen.getByLabelText("Search your notes");
    fireEvent.change(box, { target: { value: "hiring last month" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    const sent = params(urls[0]);
    expect(urls[0]).toContain("/api/search/interactions?");
    expect(sent.get("q")).toBe("hiring last month");
    expect(sent.get("limit")).toBe("20");
    expect(sent.get("offset")).toBe("0");
    expect(sent.get("mode")).toBe("auto");
    expect(sent.get("sort")).toBe("relevance");
    expect(sent.get("tz")).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(sent.has("from")).toBe(false);
  });

  it("asks from the URL it was opened with, without typing", async () => {
    const urls = stubFetch();
    mount("/search?mode=notes&q=hiring&type=call");
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(params(urls[0]).get("q")).toBe("hiring");
    expect(params(urls[0]).get("type")).toBe("call");
    expect(screen.getByLabelText("Search your notes")).toHaveProperty(
      "value",
      "hiring",
    );
  });

  it("shows the person, the date, the passage, and the period the server read", async () => {
    stubFetch();
    mount("/search?mode=notes&q=hiring+last+month");
    await screen.findByText("Sam Rivera");
    expect(screen.getByText("CTO · Acme")).toBeTruthy();
    expect(screen.getByText("Coffee with Sam")).toBeTruthy();
    // The highlight range [13, 19] is the word "hiring" in the excerpt.
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("hiring");
    expect(screen.getByText("1 note")).toBeTruthy();
    expect(screen.getByText("Search results")).toBeTruthy();
    expect(screen.getByText(/“last month” →/)).toBeTruthy();
    // The phrase set the range, so "Any time" does not show pressed beside it.
    expect(
      screen
        .getByRole("button", { name: "Any time" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    // The date reads as written, "Aug 12, 2026 · 6 weeks ago", in the muted
    // meta line: no capitals forced on it and no label tracking.
    const time = document.querySelector("time");
    expect(time?.textContent).toContain(
      new Date(HIT.date).toLocaleDateString(undefined, { dateStyle: "medium" }),
    );
    expect(time?.classList.contains("uppercase")).toBe(false);
    expect(time?.className).toContain("text-on-surface-variant");
  });

  it("sends a preset as calendar dates and shows the custom fields on request", async () => {
    const urls = stubFetch();
    mount("/search?mode=notes&q=hiring");
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(urls.some((u) => params(u).has("from"))).toBe(true),
    );
    const sent = params(urls[urls.length - 1]);
    expect(sent.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      screen
        .getByRole("button", { name: "Last 7 days" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(screen.getByLabelText("To")).toBeTruthy();
  });

  it("opens the note on its contact's page", async () => {
    stubFetch();
    mount("/search?mode=notes&q=hiring");
    fireEvent.click(await screen.findByText("Sam Rivera"));
    await screen.findByText("contact page");
  });

  it("explains an any-word fallback and lets the reader insist on every word", async () => {
    const urls = stubFetch(() =>
      answer({
        query: {
          text: "hiring freeze",
          tokens: ["hiring", "freeze"],
          mode: "any",
          phrase: null,
          range: null,
          timeZone: "UTC",
        },
      }),
    );
    mount("/search?mode=notes&q=hiring+freeze");
    await screen.findByText(/No note has every word/);
    fireEvent.click(screen.getByRole("button", { name: "All words" }));
    await waitFor(() =>
      expect(params(urls[urls.length - 1]).get("mode")).toBe("all"),
    );
  });

  it("says when nothing matched, with no count, notice or order for a list that is not there", async () => {
    stubFetch(() =>
      answer({
        total: 0,
        hits: [],
        query: {
          text: "nothing here",
          tokens: ["nothing", "here"],
          mode: "any",
          phrase: null,
          range: null,
          timeZone: "UTC",
        },
      }),
    );
    mount("/search?mode=notes&q=nothing+here");
    await screen.findByText("No notes match");
    expect(screen.queryByText("0 notes")).toBeNull();
    expect(screen.queryByText(/No note has every word/)).toBeNull();
    expect(screen.queryByRole("button", { name: "All words" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Best match" })).toBeNull();
  });

  it("starts with the box and the filters, and no suggested questions", () => {
    stubFetch();
    mount();
    expect(screen.queryByRole("list", { name: "Try asking" })).toBeNull();
    expect(screen.queryByText("Try asking")).toBeNull();
  });

  it("puts the kind first among the filters, a chip with no Kind label beside it", () => {
    stubFetch();
    mount();
    const kind = screen.getByRole("combobox", { name: "Kind of note" });
    const anyTime = screen.getByRole("button", { name: "Any time" });
    expect(
      kind.compareDocumentPosition(anyTime) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(kind.textContent).toContain("All kinds");
    expect(screen.queryByText("Kind")).toBeNull();
  });

  it("empties the results along with the search", async () => {
    stubFetch();
    mount("/search?mode=notes&q=hiring");
    await screen.findByText("Sam Rivera");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.queryByText("Sam Rivera")).toBeNull());
    expect(screen.getByLabelText("Search your notes")).toHaveProperty(
      "value",
      "",
    );
    expect(screen.queryByText("1 note")).toBeNull();
  });

  it("says it is searching while a slow answer is on its way", async () => {
    let release: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(answer());
          }),
      ),
    );
    mount("/search?mode=notes&q=hiring");
    expect(await screen.findByText("Searching…")).toBeTruthy();
    release();
    await screen.findByText("Sam Rivera");
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("keeps the last answer in place while the next loads, and swaps the cards once", async () => {
    const KIM = {
      ...HIT,
      id: "note-2",
      contactId: "contact-2",
      title: "Lunch with Kim",
      contact: { ...HIT.contact, id: "contact-2", name: "Kim Lee" },
    };
    let release: () => void = () => {};
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (!url.includes("/search/interactions"))
          return Promise.resolve(answer());
        calls += 1;
        if (calls === 1) return Promise.resolve(answer());
        return new Promise<Response>((resolve) => {
          release = () => resolve(answer({ hits: [KIM] }));
        });
      }),
    );
    const { container } = mount("/search?mode=notes&q=hiring");
    const card = (await screen.findByText("Sam Rivera")).closest("button");

    fireEvent.change(screen.getByLabelText("Search your notes"), {
      target: { value: "lunch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // The old card is the same element: it was not remounted to fade in
    // again, and nothing says "Searching…" or spins for a wait this short.
    expect(screen.getByText("Sam Rivera").closest("button")).toBe(card);
    expect(screen.queryByText("Searching…")).toBeNull();
    expect(container.querySelector("form .animate-spin")).toBeNull();

    release();
    await screen.findByText("Kim Lee");
    expect(screen.queryByText("Sam Rivera")).toBeNull();
  });

  it("dims the old answer and spins the glyph only when the next is slow", async () => {
    let release: () => void = () => {};
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (!url.includes("/search/interactions"))
          return Promise.resolve(answer());
        calls += 1;
        if (calls === 1) return Promise.resolve(answer());
        return new Promise<Response>((resolve) => {
          release = () => resolve(answer({ total: 0, hits: [] }));
        });
      }),
    );
    const { container } = mount("/search?mode=notes&q=hiring");
    await screen.findByText("Sam Rivera");
    fireEvent.change(screen.getByLabelText("Search your notes"), {
      target: { value: "zzqx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("form .animate-spin")).not.toBeNull();
    // Still the old answer, dimmed, and no shimmer in its place.
    expect(screen.getByText("Sam Rivera")).toBeTruthy();
    expect(screen.queryByText("Searching…")).toBeNull();

    release();
    await screen.findByRole("heading", { name: "No notes match" });
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector("form .animate-spin")).toBeNull();
  });

  it("starts a new question on the first page, with one request", async () => {
    const urls = stubFetch(() => answer({ total: 45 }));
    mount("/search?mode=notes&q=hiring");
    await screen.findByText("Sam Rivera");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(params(urls.at(-1)!).get("offset")).toBe("20"));

    fireEvent.change(screen.getByLabelText("Search your notes"), {
      target: { value: "coffee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(params(urls.at(-1)!).get("q")).toBe("coffee"));
    const forCoffee = urls.filter((url) => params(url).get("q") === "coffee");
    expect(forCoffee).toHaveLength(1);
    expect(params(forCoffee[0]).get("offset")).toBe("0");
  });

  it("does not ask for a stem, which the index finds by itself", async () => {
    stubFetch(() =>
      answer({
        total: 0,
        hits: [],
        query: {
          text: "hiring",
          tokens: ["hiring"],
          mode: "all",
          phrase: null,
          range: null,
          timeZone: "America/Los_Angeles",
        },
      }),
    );
    mount("/search?mode=notes&q=hiring");
    await screen.findByRole("heading", { name: "No notes match" });
    expect(screen.getByText("Try fewer or other words")).toBeTruthy();
    expect(screen.queryByText(/stem/)).toBeNull();
  });

  it("announces a failure as an alert with the reason", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: "Index unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    mount("/search?mode=notes&q=hiring");
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "Search failed" }),
    ).toBeTruthy();
  });
});

describe("Highlighted", () => {
  it("marks the ranges and nothing else", () => {
    const { container } = render(
      <Highlighted
        text="hire the hiring team"
        ranges={[
          [0, 4],
          [9, 15],
        ]}
      />,
    );
    const marks = [...container.querySelectorAll("mark")].map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(["hire", "hiring"]);
    expect(container.textContent).toBe("hire the hiring team");
    // A plain mark: the base layer paints the highlighter and the ink.
    for (const mark of container.querySelectorAll("mark")) {
      expect(mark.hasAttribute("class")).toBe(false);
    }
  });

  it("ignores a range that runs backwards or off the end", () => {
    const { container } = render(
      <Highlighted
        text="short"
        ranges={[
          [3, 2],
          [4, 40],
        ]}
      />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("short");
  });
});
