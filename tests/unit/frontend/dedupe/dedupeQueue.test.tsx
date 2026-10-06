// @vitest-environment jsdom
// Waiting behind another account's dedupe scan. One scan runs at a time on an
// instance, so the server can refuse a scan with a 429 that books a place in
// the queue. The client shows a wait, not an error, and picks the scan up when
// its turn comes.
//
// The cases: no red toast for a refusal, no progress bar frozen at zero for a
// scan that has not started, a scan that finishes between two polls still
// shows, and one dropped packet does not abandon the wait.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DedupeProvider,
  useDedupe,
} from "../../../../src/contexts/DedupeContext";
import { ManualMerge } from "../../../../src/views/dedupe/components/ManualMerge";
import { undoMerges } from "../../../../src/api/suggestions";

/** The account's Motion row. Nothing else here reads the preferences. */
let mockMotion: "system" | "reduced" = "system";
vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences: { motion: mockMotion } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An EventSource that records whether anything ever opened one. */
function stubEventSource() {
  const opened: string[] = [];
  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url: string) {
        opened.push(url);
        return { close: vi.fn() } as unknown as EventSource;
      }
    },
  );
  return opened;
}

/**
 * One client per test file: `renderHook`'s wrapper is a component, so a
 * QueryClient built in its body is new on every render and drops in-flight
 * mutations and cached answers.
 */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <DedupeProvider>{children}</DedupeProvider>
    </QueryClientProvider>
  );
}

const SCAN = (phase: string) => ({
  scanId: "queued-1",
  mode: "quick",
  phase,
  phaseName: phase,
  clusters: [],
});

describe("a scan booked behind another account's", () => {
  it("shows a wait, not a scan, and opens no stream", async () => {
    // `/dedupe/active` reports a booked scan as phase "starting" — exactly
    // what a scan that began a moment ago looks like. Only `queued` tells
    // them apart, and attaching the stream to a booked scan gets silence: the
    // dedupe SSE has no heartbeat, so it reads as a scan that has hung.
    const opened = stubEventSource();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ active: true, queued: true, scan: SCAN("starting") }),
        ),
    );

    const { result } = renderHook(() => useDedupe(), { wrapper });
    await waitFor(() => expect(result.current.isQueued).toBe(true));
    expect(result.current.scan).toBeNull();
    expect(result.current.isScanning).toBe(false);
    expect(opened).toEqual([]);
  });

  it("picks the scan up and attaches the stream when its turn comes", async () => {
    const opened = stubEventSource();
    // Booked for the first two answers — the mount read and the immediate
    // first poll — then running. The poll fires straight away on entering the
    // wait, so a mock that flips on the second call never lets the waiting
    // state be observed at all.
    let answers = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      answers += 1;
      return Promise.resolve(
        Response.json(
          answers <= 2
            ? { active: true, queued: true, scan: SCAN("starting") }
            : { active: true, queued: false, scan: SCAN("scoring") },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useDedupe(), { wrapper });
    await waitFor(() => expect(result.current.isQueued).toBe(true));
    expect(opened).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    await waitFor(() => expect(result.current.isQueued).toBe(false));
    expect(result.current.scan?.phase).toBe("scoring");
    expect(result.current.isScanning).toBe(true);
    // And only now is a stream opened, on the scan that is actually running.
    expect(opened).toEqual([
      expect.stringContaining("/dedupe/stream?scanId=queued-1"),
    ]);
  });

  it("recovers a scan that started and finished between two polls", async () => {
    // `getActiveScan` skips terminal scans, so a short scan leaves
    // `{ active: false, queued: false }` behind it. Read as "nothing to adopt",
    // the waiting card would vanish and what the scan found would never show.
    stubEventSource();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/dedupe/status")) {
        return Promise.resolve(
          Response.json({
            ...SCAN("complete"),
            clusters: [{ id: "c1" }],
          }),
        );
      }
      // Booked for the first two answers (the mount read and the first
      // poll, which is where the scan id is learned), then gone: the scan
      // ran and completed inside the gap, and `getActiveScan` skips terminal
      // scans.
      return Promise.resolve(
        fetchMock.mock.calls.length <= 2
          ? Response.json({
              active: true,
              queued: true,
              scan: SCAN("starting"),
            })
          : Response.json({ active: false, queued: false }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useDedupe(), { wrapper });
    await waitFor(() => expect(result.current.isQueued).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(result.current.isQueued).toBe(false));
    expect(result.current.scan?.phase).toBe("complete");
  });

  it("keeps waiting through a run of failed polls", async () => {
    // The server still holds the place in line, so dropping the wait shows a
    // Scan now button the server answers "a scan is already running for
    // your account" — with no way back to the waiting state.
    stubEventSource();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ active: true, queued: true, scan: SCAN("starting") }),
      )
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useDedupe(), { wrapper });
    await waitFor(() => expect(result.current.isQueued).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(result.current.isQueued).toBe(true);

    // It does give up eventually, so a tab left open on a dead server is not
    // asking forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(result.current.isQueued).toBe(false));
  });

  it("turns the queued 429 into a wait rather than an error", async () => {
    stubEventSource();
    let booked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  message:
                    "Another account's scan is running. Yours is queued.",
                  code: "RATE_LIMITED",
                  details: { yours: false, queued: true },
                },
              }),
              { status: 429 },
            ),
          );
        }
        // The server creates and enqueues the scan before it answers the
        // 429, so the very next `/dedupe/active` reports the booking.
        return Promise.resolve(
          Response.json(
            booked
              ? { active: true, queued: true, scan: SCAN("starting") }
              : { active: false, queued: false },
          ),
        );
      }),
    );

    const { result } = renderHook(() => useDedupe(), { wrapper });
    await waitFor(() => expect(result.current.isQueued).toBe(false));

    booked = true;
    await act(async () => {
      result.current.startScan("quick");
    });
    await waitFor(() => expect(result.current.isQueued).toBe(true));
    // A wait, not a scan: no progress card, nothing pretending to advance.
    expect(result.current.scan).toBeNull();
    expect(result.current.isScanning).toBe(false);
  });
});

// The review list on Pulse: the keeper's card keeps its values
//
// The manual merge: a new stage opens at its top
describe("the manual merge", () => {
  const person = (id: string, name: string) => ({
    id,
    name,
    company: "Analytical Engines",
    emails: [],
    phones: [],
    tags: [],
    sources: [],
    socialLinks: [],
    isGhost: false,
    isArchived: false,
  });

  /** jsdom has no `scrollIntoView`. Record each call and its element. */
  function stubScrollIntoView() {
    const calls: Array<{ el: Element; options: unknown }> = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element, options: unknown) {
        calls.push({ el: this, options });
      },
    });
    return calls;
  }

  /**
   * The operating system asks for full motion. `motion` reads this media
   * query once for the whole run, so the reduced case goes through the
   * account's Motion row, the other input the tool reads.
   */
  function stubFullMotion() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  /**
   * The list for the picker, and each contact in full for the comparison,
   * which reads them by id.
   */
  function stubContacts() {
    const people = [
      person("c-1", "Ada Lovelace"),
      person("c-2", "Augusta King"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const byId = people.find((p) =>
          String(url).endsWith(`/contacts/${p.id}`),
        );
        return Promise.resolve(
          Response.json(
            byId ?? (String(url).includes("/contacts") ? people : {}),
          ),
        );
      }),
    );
  }

  async function pickTwoAndCompare() {
    stubContacts();
    client.clear();
    render(
      <QueryClientProvider client={client}>
        <ManualMerge />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText("Ada Lovelace"));
    fireEvent.click(screen.getByText("Augusta King"));
    fireEvent.click(screen.getByRole("button", { name: /Compare 2 contacts/ }));
  }

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    mockMotion = "system";
  });

  it("brings the steps into view when the stage changes, and not on the first render", async () => {
    stubFullMotion();
    const calls = stubScrollIntoView();
    await pickTwoAndCompare();
    const toSteps = calls.filter(({ el }) =>
      within(el as HTMLElement).queryByRole("button", { name: /Compare/ }),
    );
    expect(toSteps).toHaveLength(1);
    expect(toSteps[0].options).toEqual({
      block: "nearest",
      behavior: "smooth",
    });
  });

  it("keeps the sticky blocks' room as scroll padding on the page's scroller", async () => {
    // The chips and the search stick to the top, Compare to the bottom. A
    // row that Tab reaches stops clear of both, and the top padding goes
    // with the picker.
    stubFullMotion();
    stubScrollIntoView();
    stubContacts();
    client.clear();
    render(
      <QueryClientProvider client={client}>
        <div data-testid="scroller" style={{ overflowY: "auto" }}>
          <ManualMerge />
        </div>
      </QueryClientProvider>,
    );
    const scroller = screen.getByTestId("scroller");
    fireEvent.click(await screen.findByText("Ada Lovelace"));
    fireEvent.click(screen.getByText("Augusta King"));
    expect(scroller.style.scrollPaddingTop).toMatch(/px$/);
    expect(scroller.style.scrollPaddingBottom).toMatch(/px$/);

    // The comparison has no sticky top, and its own Merge bar sticks to the
    // bottom, so Tab through it stops clear of the bar.
    fireEvent.click(screen.getByRole("button", { name: /Compare 2 contacts/ }));
    await waitFor(() => expect(scroller.style.scrollPaddingTop).toBe(""));
    expect(scroller.style.scrollPaddingBottom).toMatch(/px$/);
  });

  it("jumps without motion when the Motion row asks for less", async () => {
    stubFullMotion();
    mockMotion = "reduced";
    const calls = stubScrollIntoView();
    await pickTwoAndCompare();
    const toSteps = calls.filter(({ el }) =>
      within(el as HTMLElement).queryByRole("button", { name: /Compare/ }),
    );
    expect(toSteps).toHaveLength(1);
    expect(toSteps[0].options).toEqual({ block: "nearest", behavior: "auto" });
  });
});

// Undo of a merge of several contacts
//
// A group merges one contact at a time, and the merge answers with each
// merge-log id in order. Undo takes them back last first: each merge
// changed the contact the next one started from.

describe("Undo of a merge of several contacts", () => {
  it("undoes each merge, the last first, and keeps the pairs open", async () => {
    const undone: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          undone.push({ url, body: JSON.parse(String(init.body)) });
        }
        return Response.json({ success: true, conflicts: [] });
      }),
    );
    await undoMerges(client, ["log-a", "log-b"], false);
    expect(undone).toEqual([
      {
        url: "/api/dedupe/merge-log/log-b/undo",
        body: { keepSeparate: false },
      },
      {
        url: "/api/dedupe/merge-log/log-a/undo",
        body: { keepSeparate: false },
      },
    ]);
  });
});
