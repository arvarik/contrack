// @vitest-environment jsdom
// =============================================================================
// Ask results: the "Not verified by AI" mark, and the brief that streams
// =============================================================================
// A match the model has not checked wears an orange question mark named
// "Not verified by AI", on the Ask page and in the palette. A server that
// sends no `verified` leaves the mark to the chunk's `fallback`, as before.
// "Approximate" wins over both. On the Ask page the mark is a toggletip, a
// button beside the card that explains itself on a press, a focus or a
// hover. In the palette a row is an option, so the mark is a named picture.
//
// The brief streams a start, deltas that grow the text, and one terminal
// chunk. The final text replaces the streamed text in the same box. Only the
// final text reaches the "Summary status" live region, and an error removes
// the provisional text.
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
import { Command } from "cmdk";
import type { SemanticMatch } from "../../../../src/types";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/client")>()),
  apiFetch: (...args: unknown[]) => api.fetch(...args),
}));

import { ResultCard } from "../../../../src/views/search/SearchResultCards";
import { AIResultCard } from "../../../../src/components/command-palette/AiComponents";
import { SynthesisBar } from "../../../../src/components/command-palette/SynthesisBar";

afterEach(() => {
  cleanup();
  api.fetch.mockReset();
});

const match = (overrides: Partial<SemanticMatch> = {}) =>
  ({
    id: "ada",
    name: "Ada Lovelace",
    aiReason: null,
    tags: [],
    ...overrides,
  }) as SemanticMatch;

/**
 * The match marks on screen: the "Approximate" badge, and the question mark
 * whose name says "not verified by AI" (a button on the Ask page, a picture
 * in the palette).
 */
const badges = () => [
  ...(screen.queryByText("Approximate") ? ["Approximate"] : []),
  ...(screen.queryByRole("button", { name: /not verified by AI/i }) ||
  screen.queryByRole("img", { name: /not verified by AI/i })
    ? ["Not verified by AI"]
    : []),
];

const CARDS: [string, (m: SemanticMatch, isFallback: boolean) => void][] = [
  [
    "the Ask page's result card",
    (m, isFallback) =>
      render(
        <ResultCard
          match={m}
          index={0}
          isFallback={isFallback}
          onClick={() => {}}
        />,
      ),
  ],
  [
    "the palette's result card",
    (m, isFallback) =>
      render(
        <Command label="Search">
          <AIResultCard
            match={m}
            index={0}
            onSelect={() => {}}
            isFallback={isFallback}
          />
        </Command>,
      ),
  ],
];

describe.each(CARDS)("%s", (_, renderCard) => {
  it("marks a match the model has not checked as not verified by AI", () => {
    renderCard(match({ verified: false }), false);
    expect(badges()).toEqual(["Not verified by AI"]);
    // The word badge is gone: the question mark replaced it.
    expect(screen.queryByText("Unverified")).toBeNull();
  });

  it("leaves a verified match unmarked, even in an unverified list", () => {
    renderCard(match({ verified: true }), true);
    expect(badges()).toEqual([]);
  });

  it("reads the list's fallback when the server sends no verified", () => {
    renderCard(match(), true);
    expect(badges()).toEqual(["Not verified by AI"]);
    cleanup();
    renderCard(match(), false);
    expect(badges()).toEqual([]);
  });

  it("shows Approximate rather than the question mark", () => {
    renderCard(match({ approximate: true, verified: false }), true);
    expect(badges()).toEqual(["Approximate"]);
  });
});

describe("the Ask page's question mark", () => {
  const renderAsk = (onClick = vi.fn()) => {
    render(
      <ResultCard
        match={match({ verified: false })}
        index={0}
        isFallback
        onClick={onClick}
      />,
    );
    return {
      onClick,
      mark: screen.getByRole("button", {
        name: "Ada Lovelace: not verified by AI",
      }),
      card: screen.getByRole("button", { name: /^Ada Lovelace$/ }),
    };
  };

  it("sits beside the card, never inside its button", () => {
    const { mark, card } = renderAsk();
    expect(card.contains(mark)).toBe(false);
    // The corner of the card: the wrapper is the positioned parent.
    expect(mark.closest(".absolute")?.className).toMatch(/top-3 right-3/);
    // The card leaves room for it, so a long name never runs under it.
    expect(card.className).toMatch(/\bpr-12\b/);
  });

  it("describes the mark to a screen reader, open or closed", () => {
    const { mark } = renderAsk();
    const described = document.getElementById(
      mark.getAttribute("aria-describedby")!,
    );
    expect(described?.textContent).toMatch(/AI did not check the match/);
  });

  it("is not there for a verified match, and the card keeps its padding", () => {
    render(
      <ResultCard
        match={match({ verified: true })}
        index={0}
        isFallback={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /not verified/i })).toBeNull();
    expect(screen.getByRole("button").className).not.toMatch(/\bpr-12\b/);
  });
});

describe("the palette's question mark", () => {
  it("is a named picture with a title, so the option holds one control", () => {
    render(
      <Command label="Search">
        <AIResultCard
          match={match({ verified: false })}
          index={0}
          onSelect={() => {}}
          isFallback
        />
      </Command>,
    );
    const mark = screen.getByRole("img", { name: "Not verified by AI" });
    expect(mark.getAttribute("title")).toBe("Not verified by AI");
    expect(mark.className).toMatch(/\btext-warning\b/);
    // The option's own name carries it, so a reader hears it on the row.
    expect(
      screen.getByRole("option", { name: /Ada Lovelace.*Not verified by AI/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// Three, because the synthesis bar hides itself under three results.
const CONTACTS = ["Ada Lovelace", "Grace Hopper", "Edsger Dijkstra"].map(
  (name, i) => ({ id: `contact-${i}`, name }),
);
const FINAL = "You have two people who like espresso.";

const line = (value: unknown) => JSON.stringify(value) + "\n";

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

/** Render the bar and press Synthesize, which the server answers with `response`. */
function askForBrief(response: Response) {
  api.fetch.mockResolvedValue(response);
  render(
    <SynthesisBar
      query="Who likes espresso?"
      contacts={CONTACTS}
      resultCount={CONTACTS.length}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Synthesize these results/ }),
  );
}

/** The visible brief. The live region holds the same words once they are final. */
const brief = (text: string) => screen.findByText(text, { selector: "p" });

const summaryStatus = () =>
  screen.getByRole("status", { name: "Summary status" });

/** Let the stream deliver what was pushed, and React render it. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("the streamed brief", () => {
  it("grows the text in one box, then replaces it with the final text", async () => {
    const pending = stream();
    askForBrief(pending.response);

    // A start alone changes nothing. The skeleton waits for text.
    pending.push(line({ phase: "start" }));
    await settle();
    expect(screen.getByText("Synthesizing…")).toBeTruthy();

    pending.push(line({ phase: "delta", text: "You have" }));
    const first = await brief("You have");
    expect(first.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.queryByText("Synthesizing…")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Dismiss synthesis" }),
    ).toBeNull();
    expect(summaryStatus().textContent).toBe("");

    pending.push(line({ phase: "delta", text: " two people" }));
    await brief("You have two people");
    expect(summaryStatus().textContent).toBe("");

    pending.push(line({ phase: "complete", text: FINAL }));
    pending.end();
    const final = await brief(FINAL);
    // The same element: the keyed slot did not remount, so no crossfade ran.
    expect(final).toBe(first);
    expect(final.closest("[aria-busy]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Dismiss synthesis" }),
    ).toBeTruthy();
    await waitFor(() => expect(summaryStatus().textContent).toBe(FINAL));
  });

  it("removes the provisional text when an error follows the deltas", async () => {
    const pending = stream();
    askForBrief(pending.response);

    pending.push(line({ phase: "start" }));
    pending.push(line({ phase: "delta", text: "You have" }));
    await brief("You have");

    pending.push(
      line({ phase: "error", error: "The provider is not answering" }),
    );
    await screen.findByText("Synthesis failed: The provider is not answering");
    expect(screen.queryByText("You have")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(summaryStatus().textContent).toBe("");
  });

  it("shows a cached brief that arrives whole, with no deltas", async () => {
    askForBrief(
      new Response(
        line({ phase: "start" }) + line({ phase: "complete", text: FINAL }),
      ),
    );
    await brief(FINAL);
    await waitFor(() => expect(summaryStatus().textContent).toBe(FINAL));
  });

  it("fails a brief whose deltas add up to more than 20,000 characters", async () => {
    const piece = "a".repeat(10_001);
    askForBrief(
      new Response(
        line({ phase: "start" }) +
          line({ phase: "delta", text: piece }) +
          line({ phase: "delta", text: piece }) +
          line({ phase: "complete", text: FINAL }),
      ),
    );
    await screen.findByText("Synthesis failed: The summary is too long");
    expect(screen.queryByText(FINAL)).toBeNull();
    expect(summaryStatus().textContent).toBe("");
  });
});
