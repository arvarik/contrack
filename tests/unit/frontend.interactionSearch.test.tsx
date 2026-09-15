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

/** Stub `fetch`, answer every request the same way, and keep every URL. */
function stubFetch(reply: () => Response = answer) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
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
  it("sends the question, the reader's zone and the page size", async () => {
    const urls = stubFetch();
    mount();
    fireEvent.change(screen.getByLabelText("Search your notes"), {
      target: { value: "hiring last month" },
    });
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
    expect(screen.getByText(/“last month” →/)).toBeTruthy();
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

  it("says when nothing matched", async () => {
    stubFetch(() => answer({ total: 0, hits: [] }));
    mount("/search?mode=notes&q=nothing");
    await screen.findByText("No notes match");
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
