// Unit: normalizePhone.
// Connectors, MCP lookups, contact syncs and the duplicate scan match phone
// numbers by this key. One number written in national and in international
// form must give one key, or a synced card adds the number a second time and
// the scan misses a duplicate. Two numbers must not share a key, because a
// shared phone can merge two contacts without asking.

import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../../../server/utils/nlp/phone.ts";

describe("normalizePhone", () => {
  it.each([
    ["France", "06 12 34 56 78", "+33 6 12 34 56 78"],
    ["France, dialed with 00", "06 12 34 56 78", "0033 6 12 34 56 78"],
    ["Spain", "612 34 56 78", "+34 612 34 56 78"],
    ["Norway", "412 34 567", "+47 412 34 567"],
    ["Germany", "030 1234567", "+49 30 1234567"],
    ["Italy", "06 1234 5678", "+39 06 1234 5678"],
    ["the UK, with a (0)", "07700 900123", "+44 (0)7700 900123"],
    ["the US", "(415) 555-1234", "+1 415 555 1234"],
    ["the US, dialed with 1", "1-415-555-1234", "+1 (415) 555-1234"],
    ["China", "138 1234 5678", "+86 138 1234 5678"],
    ["Russia, dialed with 8", "8 912 345-67-89", "+7 912 345-67-89"],
  ])(
    "gives a number from %s one key in both forms",
    (_, national, international) => {
      expect(normalizePhone(national)).toBe(normalizePhone(international));
    },
  );

  it("keeps one local number in two area codes apart", () => {
    expect(normalizePhone("+1 415 555 1234")).not.toBe(
      normalizePhone("+1 305 555 1234"),
    );
  });
});
