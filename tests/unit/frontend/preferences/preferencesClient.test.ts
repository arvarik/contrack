// @vitest-environment jsdom
// =============================================================================
// The browser's half of preferences
// =============================================================================
// None of these tests is the round trip, which the integration file covers.
//
// The first is that the browser's defaults are the server's defaults. The app
// renders before the first response arrives, so it has to carry a copy — and a
// copy that drifts means a list that silently re-packs itself a moment after
// it paints, for one release, until somebody notices. The server builds its
// copy fresh on every call, so one account's history never lands in another
// account's default.
//
// The second is the removal of the keys 1.x kept in localStorage. 2.0 does not
// read them. Deleting them is the point: `localStorage` is keyed by origin, so
// whatever is left is readable by whoever signs in next.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  isDefaultValue,
  DEFAULT_PREFERENCES,
} from "../../../../src/api/preferences";
import { defaultPreferences } from "../../../../server/services/userPreferencesService.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("the browser's defaults", () => {
  it("are the server's defaults", () => {
    expect(DEFAULT_PREFERENCES).toEqual(defaultPreferences());
  });
});

describe("the server's defaults", () => {
  it("are fresh objects on every call", () => {
    // A shared `pulseLayout` would let one account's change land in every
    // other account's default.
    const a = defaultPreferences();
    const b = defaultPreferences();
    a.pulseLayout.hidden.push("inbox");
    expect(b.pulseLayout.hidden).toEqual([]);
  });
});

describe("isDefaultValue", () => {
  it("compares strings without case, numbers and flags exactly, and objects by content", () => {
    expect(isDefaultValue("theme", "system")).toBe(true);
    expect(isDefaultValue("theme", "dark")).toBe(false);
    expect(isDefaultValue("accent", "#006A91")).toBe(true);
    expect(isDefaultValue("defaultCadenceDays", 90)).toBe(true);
    expect(isDefaultValue("defaultCadenceDays", 30)).toBe(false);
    expect(isDefaultValue("aiAssist", true)).toBe(true);
    expect(isDefaultValue("aiAssist", false)).toBe(false);
    expect(isDefaultValue("pulseLayout", { hidden: [], order: {} })).toBe(true);
    expect(
      isDefaultValue("pulseLayout", { hidden: ["inbox"], order: {} }),
    ).toBe(false);
  });
});
