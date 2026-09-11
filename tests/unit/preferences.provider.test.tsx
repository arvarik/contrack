// @vitest-environment jsdom
// =============================================================================
// PreferencesProvider — the reader, the writer, and the one-time migration
// =============================================================================
// Three behaviours that only show up in the wiring, so none of them is covered
// by the service tests or the hook tests.
//
// Reading before the server answers. The provider hands out the defaults
// rather than `undefined`, because the alternative makes every call site
// handle a state whose honest answer is "the default".
//
// Writing optimistically, and putting the value BACK when the write fails. A
// control that keeps showing a choice the server refused is a lie, and it is
// the case nobody exercises by hand.
//
// The migration, which must run exactly once and must not overwrite a choice
// the account already made on another device.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PreferencesProvider,
  usePreferences,
} from "../../src/contexts/PreferencesContext";
import { DEFAULT_PREFERENCES } from "../../src/api/preferences";
import { LEGACY_KEYS } from "../../src/lib/localPreferenceMigration";

/** Requests the app made, newest last. */
let calls: { url: string; method: string; body: unknown }[] = [];

/** The account's stored preferences, as the fake server holds them. */
let stored: Record<string, unknown> = {};

/** Set to refuse the next PATCH. */
let refusePatch = false;

/**
 * When set, every PATCH waits on this before answering.
 *
 * That is what makes "optimistic" testable at all: with the response held
 * open, a value that has already changed on screen can only have come from the
 * optimistic write.
 */
let holdPatch: Promise<void> | null = null;
let releasePatch: (() => void) | null = null;

function holdTheNextPatch() {
  holdPatch = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (method === "PATCH") {
        if (holdPatch) await holdPatch;
        if (refusePatch) {
          return new Response(JSON.stringify({ error: { message: "no" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        stored = { ...stored, ...(body as Record<string, unknown>) };
      }

      return new Response(
        JSON.stringify({
          preferences: { ...DEFAULT_PREFERENCES, ...stored },
          stored: Object.keys(stored),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PreferencesProvider>{children}</PreferencesProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  calls = [];
  stored = {};
  refusePatch = false;
  holdPatch = null;
  releasePatch = null;
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const patches = () =>
  calls.filter((c) => c.method === "PATCH").map((c) => c.body);

describe("reading", () => {
  it("answers with the defaults before the server has", () => {
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(result.current.isLoaded).toBe(false);
  });

  it("replaces them with the account's own choices", async () => {
    stored = { listDensity: "compact", theme: "dark" };
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.preferences.listDensity).toBe("compact");
    expect(result.current.mode).toBe("dark");
  });

  it("asks for them once, not once per reader", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => [usePreferences(), usePreferences(), usePreferences()],
      { wrapper },
    );
    await waitFor(() => expect(result.current[0].isLoaded).toBe(true));
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
});

describe("writing", () => {
  it("shows the new value before the server has answered", async () => {
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    holdTheNextPatch();
    act(() => result.current.setPreference("listDensity", "compact"));

    // The request is out and unanswered, and the control already reads
    // "compact". A density toggle that waits for a round trip feels broken.
    await waitFor(() =>
      expect(result.current.preferences.listDensity).toBe("compact"),
    );
    expect(patches()).toEqual([{ listDensity: "compact" }]);

    await act(async () => {
      releasePatch!();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.preferences.listDensity).toBe("compact"),
    );
  });

  it("sends only the preference that changed", async () => {
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.setPreference("recentLimit", 6));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({ recentLimit: 6 });
  });

  it("puts the old value back when the server refuses", async () => {
    stored = { listDensity: "comfortable" };
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    refusePatch = true;
    holdTheNextPatch();
    act(() => result.current.setPreference("listDensity", "compact"));

    // Optimistic first...
    await waitFor(() =>
      expect(result.current.preferences.listDensity).toBe("compact"),
    );

    // ...then back, because the server said no.
    await act(async () => {
      releasePatch!();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.preferences.listDensity).toBe("comfortable"),
    );
  });

  it("paints the theme it was given", async () => {
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.setPreference("theme", "dark"));
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
    expect(result.current.mode).toBe("dark");
  });
});

describe("following the machine", () => {
  /** A media query whose answer can be changed from the test. */
  function controllableMedia(initialDark: boolean) {
    let dark = initialDark;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return dark && query.includes("dark");
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) =>
          listeners.delete(fn),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );
    return (next: boolean) => {
      dark = next;
      for (const fn of listeners) fn();
    };
  }

  it("moves with the operating system while the app is open", async () => {
    // The case an effect that only ran on a preference change could not see: a
    // machine that switches at sunset with the tab already open.
    const setDark = controllableMedia(false);
    stored = { theme: "system" };

    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.mode).toBe("light");

    act(() => setDark(true));
    await waitFor(() => expect(result.current.mode).toBe("dark"));
    // And still no attribute: the stylesheet's own media query is the answer.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("ignores the machine once a palette has been chosen", async () => {
    const setDark = controllableMedia(false);
    stored = { theme: "light" };

    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => setDark(true));
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );
    expect(result.current.mode).toBe("light");
  });
});

describe("the one-time migration", () => {
  it("sends what the browser still holds, once", async () => {
    localStorage.setItem(LEGACY_KEYS.listDensity, "compact");
    localStorage.setItem(LEGACY_KEYS.tempUnit, "fahrenheit");

    const { result, rerender } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      listDensity: "compact",
      tempUnit: "fahrenheit",
    });

    rerender();
    rerender();
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(patches()).toHaveLength(1);

    // And the browser no longer holds them.
    expect(localStorage.getItem(LEGACY_KEYS.listDensity)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.tempUnit)).toBeNull();
  });

  it("leaves a choice the account already made on another device", async () => {
    stored = { listDensity: "comfortable" };
    localStorage.setItem(LEGACY_KEYS.listDensity, "compact");

    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await waitFor(() =>
      expect(localStorage.getItem(LEGACY_KEYS.listDensity)).toBeNull(),
    );

    expect(patches()).toEqual([]);
    expect(result.current.preferences.listDensity).toBe("comfortable");
  });

  it("sends nothing when the browser holds nothing", async () => {
    const { result } = renderHook(() => usePreferences(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(patches()).toEqual([]);
  });
});
