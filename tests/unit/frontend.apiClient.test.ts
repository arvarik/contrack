// @vitest-environment jsdom
// =============================================================================
// The shared API client is the only way out of the app
// =============================================================================
// The server can answer an ordinary request with "your session expired", "your
// account is disabled", or "change your password first". Each of those needs
// the whole app to change screen, and only `AuthGate` can do that. A view
// cannot, and eleven views deciding separately would decide it eleven ways.
//
// So every call goes through `src/api/client.ts`, which recognises the answer
// and announces it once on the window. A module that calls `fetch` directly
// opts out of that silently: it still works, it still shows an error, and the
// person is left staring at a failed page with no way to sign back in.
//
// The first block below is the scanner that stops that from creeping back.
// The rest pin the behaviour it is protecting.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  apiFetch,
  apiJson,
  handleResponse,
  rateLimitFacts,
} from "../../src/api/client";
import { rateLimitMessage } from "../../src/lib/rateLimitMessage";
import { useDedupeStream } from "../../src/api/dedupe";
import {
  AUTH_EXPIRED_EVENT,
  PASSWORD_CHANGE_REQUIRED_EVENT,
} from "../../src/lib/appEvents";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/**
 * The source root.
 *
 * `process.cwd()` rather than `import.meta.url`: this file runs under jsdom,
 * where `import.meta.url` is resolved against the document base and comes out
 * as an http URL whose pathname is not on disk. Vitest runs from the repo
 * root. `sanity()` below refuses to let the scan pass by finding nothing.
 */
const SRC = path.resolve(process.cwd(), "src");

/** Every `.ts` and `.tsx` file under src/, with its path relative to src/. */
function sourceFiles(dir = SRC, prefix = ""): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path.join(dir, entry.name), rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push({
        file: rel,
        text: fs.readFileSync(path.join(dir, entry.name), "utf8"),
      });
    }
  }
  return out;
}

/**
 * A bare `fetch(` — not `apiFetch(`, `prefetch`, or `refetch`.
 *
 * The leading character class is what keeps `apiFetch(` and
 * `queryClient.prefetchQuery(` out of the results: both end in something this
 * pattern rejects immediately before the word.
 */
const BARE_FETCH = /(^|[^A-Za-z.])fetch\s*\(/;

/** Lines that call `fetch` directly, as `file:line`. */
function bareFetchLines(file: string, text: string): string[] {
  return text
    .split("\n")
    .map((line, index) => ({ line, no: index + 1 }))
    .filter(({ line }) => BARE_FETCH.test(line))
    .map(({ no }) => `${file}:${no}`);
}

describe("every call to this app's API goes through the shared client", () => {
  it("is actually reading the source tree", () => {
    // A scanner that silently stops finding files is worse than no scanner,
    // because the report keeps printing a reassuring zero. Two anchors: the
    // transport itself, and a bare fetch the scanner must be able to see.
    const files = sourceFiles();
    expect(files.map((f) => f.file)).toContain("api/client.ts");
    expect(files.length).toBeGreaterThan(50);
    const transport = files.find((f) => f.file === "api/client.ts")!;
    expect(bareFetchLines(transport.file, transport.text).length).toBe(1);
  });

  it("finds no bare fetch under src/api/ outside the two transports", () => {
    // `client.ts` is the transport itself. `auth.ts` holds the endpoints that
    // answer before we know whether we may ask anything else — routing
    // `/status` through the shared client would have a signed-out browser
    // announce its own 401 to the gate that is asking the question.
    const allowed = new Set(["api/client.ts", "api/auth.ts"]);
    const offenders = sourceFiles()
      .filter(({ file }) => file.startsWith("api/") && !allowed.has(file))
      .flatMap(({ file, text }) => bareFetchLines(file, text));
    expect(offenders).toEqual([]);
  });

  it("finds no call anywhere in src/ that reaches /api without the client", () => {
    // Wider than the directory rule on purpose. Three components used to call
    // `/api/...` with a bare `fetch` — the bulk import, the link unfurler —
    // and each one was a route the server can answer with a 403 that nothing
    // would have acted on. A fetch of a third-party URL is fine and is why
    // this tests the argument rather than the call.
    const allowed = new Set(["api/client.ts", "api/auth.ts"]);
    const offenders = sourceFiles()
      .filter(({ file }) => !allowed.has(file))
      .flatMap(({ file, text }) =>
        text
          .split("\n")
          .map((line, index) => ({ line, no: index + 1 }))
          .filter(
            ({ line }) =>
              BARE_FETCH.test(line) && /["'`]\/api|API_BASE/.test(line),
          )
          .map(({ no }) => `${file}:${no}`),
      );
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the client does with each answer
// ---------------------------------------------------------------------------

function respondWith(body: unknown, init: ResponseInit) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), init)),
  );
}

/** Collect one window event and give the listener back for cleanup. */
function listen(name: string) {
  const spy = vi.fn();
  window.addEventListener(name, spy);
  return {
    spy,
    stop: () => window.removeEventListener(name, spy),
  };
}

describe("refusals that change which screen the app is", () => {
  it("announces a 401 as an expired credential", async () => {
    const expired = listen(AUTH_EXPIRED_EVENT);
    respondWith(
      { error: { message: "Sign in again", code: "UNAUTHORIZED" } },
      {
        status: 401,
      },
    );
    await expect(apiFetch("/contacts")).rejects.toBeInstanceOf(ApiError);
    expect(expired.spy).toHaveBeenCalledOnce();
    expect((expired.spy.mock.calls[0][0] as CustomEvent).detail).toEqual({
      reason: "expired",
    });
    expired.stop();
  });

  it("announces a disabled account with its own reason", async () => {
    // The two share a screen and must not share its words. Telling somebody
    // whose account an administrator closed to try their password again sends
    // them round a loop that cannot end.
    const expired = listen(AUTH_EXPIRED_EVENT);
    respondWith(
      {
        error: {
          message: "This account is disabled.",
          code: "ACCOUNT_DISABLED",
        },
      },
      { status: 403 },
    );
    await expect(apiFetch("/contacts")).rejects.toMatchObject({ status: 403 });
    expect((expired.spy.mock.calls[0][0] as CustomEvent).detail).toEqual({
      reason: "disabled",
    });
    expired.stop();
  });

  it("announces a forced password change separately from a sign-out", async () => {
    // The credential is fine here. The server is holding one door shut, not
    // all of them, so asking for a password again would be nonsense.
    const forced = listen(PASSWORD_CHANGE_REQUIRED_EVENT);
    const expired = listen(AUTH_EXPIRED_EVENT);
    respondWith(
      {
        error: {
          message: "Change your password first.",
          code: "PASSWORD_CHANGE_REQUIRED",
        },
      },
      { status: 403 },
    );
    await expect(apiFetch("/contacts")).rejects.toMatchObject({ status: 403 });
    expect(forced.spy).toHaveBeenCalledOnce();
    expect(expired.spy).not.toHaveBeenCalled();
    forced.stop();
    expired.stop();
  });

  it("leaves an ordinary 403 to the caller", async () => {
    const forced = listen(PASSWORD_CHANGE_REQUIRED_EVENT);
    const expired = listen(AUTH_EXPIRED_EVENT);
    respondWith(
      { error: { message: "Not yours.", code: "FORBIDDEN" } },
      { status: 403 },
    );
    await expect(apiFetch("/contacts/x")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(forced.spy).not.toHaveBeenCalled();
    expect(expired.spy).not.toHaveBeenCalled();
    forced.stop();
    expired.stop();
  });
});

describe("rate limits reach the UI intact", () => {
  it("carries the envelope details and the Retry-After header", async () => {
    respondWith(
      {
        error: {
          message: "Too many requests",
          code: "RATE_LIMITED",
          details: { yours: true, queued: false, retryAfterSeconds: 42 },
        },
      },
      { status: 429, headers: { "Retry-After": "42" } },
    );
    const error = await apiFetch("/ai-search").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(42);
    expect(rateLimitFacts(error)).toEqual({
      yours: true,
      queued: false,
      retryAfterSeconds: 42,
    });
  });

  it("reads the wait from the body when there is no header", async () => {
    // The dedupe lock sends no `Retry-After` because it has no estimate to
    // give, and the AI Search cooldown sends the number in `details`. Both
    // shapes have to work or one feature's countdown is blank.
    respondWith(
      {
        error: {
          message: "Cooling down",
          code: "RATE_LIMITED",
          details: { yours: true, queued: false, retryAfterSeconds: 7 },
        },
      },
      { status: 429 },
    );
    const error = await apiFetch("/ai-search").catch((e) => e);
    expect(error.retryAfterSeconds).toBeUndefined();
    expect(rateLimitFacts(error)?.retryAfterSeconds).toBe(7);
  });

  it("treats an absent `yours` as the caller's own limit", () => {
    // The per-account limiters do not send the flag; only the shared locks
    // do. Defaulting the other way would blame a stranger for everybody's
    // own rate limit.
    const own = new ApiError(
      "slow down",
      429,
      "RATE_LIMITED",
      undefined,
      3000,
      {},
    );
    expect(rateLimitFacts(own)?.yours).toBe(true);
  });

  it("is null for anything that is not a 429", () => {
    expect(rateLimitFacts(new ApiError("gone", 404))).toBeNull();
    expect(rateLimitFacts(new Error("bug"))).toBeNull();
    expect(rateLimitFacts(null)).toBeNull();
  });
});

describe("the sentence shown for a 429", () => {
  const limited = (details: unknown, retryAfterMs?: number) =>
    new ApiError("x", 429, "RATE_LIMITED", undefined, retryAfterMs, details);

  it("names the other account when the lock is not the reader's", () => {
    expect(
      rateLimitMessage(limited({ yours: false, queued: true }), "scan"),
    ).toBe("Another user's scan is running. Yours will start automatically.");
    expect(
      rateLimitMessage(limited({ yours: false, queued: false }), "enrichment"),
    ).toBe("Another user's enrichment is running. Try again in a moment.");
  });

  it("counts the seconds when the limit is the reader's own", () => {
    expect(rateLimitMessage(limited({ retryAfterSeconds: 30 }))).toBe(
      "Too many requests. Try again in 30 seconds.",
    );
    expect(rateLimitMessage(limited({ retryAfterSeconds: 1 }))).toBe(
      "Too many requests. Try again in 1 second.",
    );
  });

  it("says nothing precise when the server gave no estimate", () => {
    expect(rateLimitMessage(limited({}))).toBe(
      "Too many requests. Try again shortly.",
    );
  });

  it("returns null for a failure that is not a rate limit", () => {
    // Null rather than a fallback sentence, so a caller can tell "this is a
    // limit, here is what to say" from "use the server's own message".
    expect(rateLimitMessage(new ApiError("nope", 400))).toBeNull();
  });
});

describe("handleResponse", () => {
  it("parses a JSON body", async () => {
    await expect(
      handleResponse<{ ok: boolean }>(Response.json({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it("resolves to undefined for a 204 and for an empty body", async () => {
    // A delete endpoint that returns nothing should not have to pretend to
    // return something, and `res.json()` on an empty body throws.
    await expect(
      handleResponse(new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();
    await expect(
      handleResponse(new Response("", { status: 200 })),
    ).resolves.toBeUndefined();
  });

  it("throws the same ApiError apiFetch throws", async () => {
    const res = new Response(
      JSON.stringify({ error: { message: "Nope", code: "NOPE" } }),
      { status: 400 },
    );
    await expect(handleResponse(res)).rejects.toMatchObject({
      status: 400,
      code: "NOPE",
      message: "Nope",
    });
  });

  it("reads the whole round trip through apiJson", async () => {
    respondWith({ users: [] }, { status: 200 });
    await expect(apiJson("/admin/users")).resolves.toEqual({ users: [] });
  });
});

// ---------------------------------------------------------------------------
// The stream that cannot report why it failed
// ---------------------------------------------------------------------------

function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("a dead dedupe stream falls back to polling", () => {
  it("keeps reporting progress after the EventSource gives up", async () => {
    // An `EventSource` error carries no status and no body, so a blip and a
    // revoked session arrive identically. After the retries the client asks
    // `/status` which of the two it was; a browser that is still signed in
    // means the scan is fine and only the transport broke, so progress comes
    // from polling. Before this, four failures meant a progress bar that
    // never moved again for a scan that finished normally.
    let source!: {
      onmessage?: (e: { data: string }) => void;
      onerror?: () => void;
      close: () => void;
    };
    const opened = vi.fn();
    vi.stubGlobal(
      "EventSource",
      class {
        constructor() {
          opened();
          source = { close: vi.fn() };
          return source as unknown as EventSource;
        }
      },
    );

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/status"))
        return Promise.resolve(
          Response.json({
            authRequired: true,
            authenticated: true,
            user: { status: "active" },
          }),
        );
      return Promise.resolve(
        Response.json({ scanId: "s1", phase: "scoring", phaseName: "Scoring" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const onUpdate = vi.fn();
    renderHook(() => useDedupeStream("s1", onUpdate), {
      wrapper: queryWrapper(),
    });

    // Four failures: three retries, then the diagnosis.
    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => {
        source.onerror?.();
        await vi.advanceTimersByTimeAsync(2000);
      });
    }

    expect(opened).toHaveBeenCalledTimes(4);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/status")),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "scoring" }),
      ),
    );
  });

  it("hands a signed-out browser to the gate instead of polling it", async () => {
    // Polling a browser the server has stopped accepting is a request per
    // three seconds that can only fail. The gate takes the screen instead.
    const expired = listen(AUTH_EXPIRED_EVENT);
    let source!: { onerror?: () => void; close: () => void };
    vi.stubGlobal(
      "EventSource",
      class {
        constructor() {
          source = { close: vi.fn() };
          return source as unknown as EventSource;
        }
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ authRequired: true, authenticated: false, user: null }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const onUpdate = vi.fn();
    renderHook(() => useDedupeStream("s1", onUpdate), {
      wrapper: queryWrapper(),
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => {
        source.onerror?.();
        await vi.advanceTimersByTimeAsync(2000);
      });
    }

    await waitFor(() => expect(expired.spy).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(
      fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/dedupe/status"),
      ),
    ).toHaveLength(0);
    expired.stop();
  });
});
