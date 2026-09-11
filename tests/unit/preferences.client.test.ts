// @vitest-environment jsdom
// =============================================================================
// The browser's half of preferences
// =============================================================================
// Two things are tested here and neither is the round trip, which the
// integration file covers.
//
// The first is that the browser's defaults are the server's defaults. The app
// renders before the first response arrives, so it has to carry a copy — and a
// copy that drifts means a list that silently re-packs itself a moment after
// it paints, for one release, until somebody notices.
//
// The second is the one-time move out of localStorage. It runs once per
// browser, reads values written by older versions of this app, and then
// deletes them. Deleting them is the point: `localStorage` is keyed by origin,
// so whatever is left is readable by whoever signs in next.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PREFERENCES } from "../../src/api/preferences";
import {
  LEGACY_KEYS,
  takeLocalPreferences,
} from "../../src/lib/localPreferenceMigration";
import { defaultPreferences } from "../../server/services/userPreferencesService.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("the browser's defaults", () => {
  it("are the server's defaults", () => {
    expect(DEFAULT_PREFERENCES).toEqual(defaultPreferences());
  });

  it("do not share an array with anything else", () => {
    // A shared `searchHistory` array would let one component's push land in
    // every other reader's default.
    const a = defaultPreferences();
    const b = defaultPreferences();
    a.searchHistory.push({ query: "x", mode: "normal", timestamp: 1 });
    expect(b.searchHistory).toEqual([]);
  });
});

describe("takeLocalPreferences", () => {
  it("finds nothing in a browser that has nothing", () => {
    expect(takeLocalPreferences([])).toEqual({});
  });

  it("reads every key an older version could have written", () => {
    localStorage.setItem(LEGACY_KEYS.listDensity, "compact");
    localStorage.setItem(LEGACY_KEYS.recentLimit, "7");
    localStorage.setItem(
      LEGACY_KEYS.dedupePreset,
      JSON.stringify({ preset: "conservative" }),
    );
    localStorage.setItem(LEGACY_KEYS.tempUnit, "fahrenheit");
    localStorage.setItem(
      LEGACY_KEYS.searchHistory,
      JSON.stringify([{ query: "vcs in sf", mode: "ai", timestamp: 12 }]),
    );

    expect(takeLocalPreferences([])).toEqual({
      listDensity: "compact",
      recentLimit: 7,
      dedupePreset: "conservative",
      tempUnit: "fahrenheit",
      searchHistory: [{ query: "vcs in sf", mode: "ai", timestamp: 12 }],
    });
  });

  it("understands the dedupe blob from before the slider was removed", () => {
    // The old shape held a raw threshold. Dropping it would silently reset
    // anybody who has not opened the dedupe settings since.
    for (const [threshold, preset] of [
      [0.88, "aggressive"],
      [0.9, "aggressive"],
      [0.93, "default"],
      [0.97, "conservative"],
    ] as const) {
      localStorage.clear();
      localStorage.setItem(
        LEGACY_KEYS.dedupePreset,
        JSON.stringify({ autoMergeThreshold: threshold }),
      );
      expect(takeLocalPreferences([]).dedupePreset, String(threshold)).toBe(
        preset,
      );
    }
  });

  it("does not overwrite a choice the account already made elsewhere", () => {
    // The server's value came from a device somebody used deliberately. A
    // stale local one arriving behind it would read as "my phone reset my
    // laptop".
    localStorage.setItem(LEGACY_KEYS.listDensity, "compact");
    localStorage.setItem(LEGACY_KEYS.tempUnit, "fahrenheit");

    expect(takeLocalPreferences(["listDensity"])).toEqual({
      tempUnit: "fahrenheit",
    });
  });

  it("removes every key, including the ones it did not send", () => {
    // A key skipped because the account had already chosen is exactly the key
    // that must not be left lying in a shared browser.
    for (const key of Object.values(LEGACY_KEYS)) {
      localStorage.setItem(key, "compact");
    }
    takeLocalPreferences(["listDensity", "tempUnit"]);
    for (const key of Object.values(LEGACY_KEYS)) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });

  it("drops values it cannot make sense of", () => {
    localStorage.setItem(LEGACY_KEYS.listDensity, "roomy");
    localStorage.setItem(LEGACY_KEYS.recentLimit, "not a number");
    localStorage.setItem(LEGACY_KEYS.dedupePreset, "{broken");
    localStorage.setItem(LEGACY_KEYS.tempUnit, "kelvin");
    localStorage.setItem(LEGACY_KEYS.searchHistory, '"a string"');

    expect(takeLocalPreferences([])).toEqual({});
  });

  it("clamps a recent limit an older build allowed", () => {
    localStorage.setItem(LEGACY_KEYS.recentLimit, "99");
    expect(takeLocalPreferences([]).recentLimit).toBe(10);
    localStorage.setItem(LEGACY_KEYS.recentLimit, "-4");
    expect(takeLocalPreferences([]).recentLimit).toBe(0);
  });

  it("sends a search history the server will accept", () => {
    // The server refuses more than twenty entries, a query past 200 characters,
    // and a mode it does not know. A migration that sent any of those would be
    // refused as a whole and the history would be lost rather than trimmed.
    const entries = Array.from({ length: 40 }, (_, i) => ({
      query: "q".repeat(400) + i,
      mode: "normal",
      timestamp: i,
    }));
    entries.push({ query: "", mode: "normal", timestamp: 1 });
    entries.push({ query: "fine", mode: "telepathy", timestamp: 1 });
    localStorage.setItem(LEGACY_KEYS.searchHistory, JSON.stringify(entries));

    const history = takeLocalPreferences([]).searchHistory!;
    expect(history).toHaveLength(20);
    for (const entry of history) {
      expect(entry.query.length).toBeLessThanOrEqual(200);
      expect(["normal", "ai", "action"]).toContain(entry.mode);
      expect(Number.isInteger(entry.timestamp)).toBe(true);
    }
  });

  it("does not send an empty history, which would count as a choice", () => {
    // Storing `[]` marks the key as chosen, and the account would then never
    // migrate a real history from another browser.
    localStorage.setItem(LEGACY_KEYS.searchHistory, "[]");
    expect(takeLocalPreferences([])).toEqual({});
  });
});
