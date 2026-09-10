// @vitest-environment jsdom
// =============================================================================
// Waiting behind another account's dedupe scan
// =============================================================================
// One scan runs at a time on an instance, so from 2.0 a scan can be refused
// because somebody else is scanning. The server books a place in the queue and
// says so in the 429; the client has to show a wait rather than an error, and
// pick the scan up when its turn comes.
//
// Every case here is one the server can produce and the UI used to get wrong:
// a red toast for a refusal that was not a failure, a progress bar frozen at
// zero for a scan that had not started, a scan that finished between two polls
// and vanished, and a wait abandoned by one dropped packet.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DedupeProvider, useDedupe } from "../../src/contexts/DedupeContext";

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
 * One client per test file, not one per render.
 *
 * `renderHook`'s wrapper is a component: building a QueryClient in its body
 * makes a new one on every render, which throws away in-flight mutations and
 * every cached answer at the worst possible moment.
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
    // `{ active: false, queued: false }` behind it. Treating that as "the
    // wait is over, nothing to adopt" made the waiting card vanish and the
    // pre-scan page return, with the clusters it found never shown.
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
    expect(result.current.clusters).toEqual([{ id: "c1" }]);
  });

  it("keeps waiting through a run of failed polls", async () => {
    // The server still holds the place in line, so dropping the wait shows a
    // Begin Scan button the server answers "a scan is already running for
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
