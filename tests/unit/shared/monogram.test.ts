// =============================================================================
// shared/monogram.ts: the initials circle, drawn the same on both sides
// =============================================================================
// The server serves it for `/api/avatar/initials`, and the screens that
// create an account draw it in the browser, because they have no session to
// ask the server with. One function draws both, so the two cannot drift.
// =============================================================================
import { describe, expect, it } from "vitest";
import { monogramLetters, monogramSvg } from "../../../shared/monogram";
import { renderAvatar } from "../../../server/services/avatarService";

describe("the monogram", () => {
  it("takes the first letter of the first two words", () => {
    expect(monogramLetters("ada lovelace byron")).toBe("AL");
    expect(monogramLetters("  cher ")).toBe("C");
    expect(monogramLetters("")).toBe("?");
    expect(monogramLetters("Émile Zola")).toBe("ÉZ");
  });

  it("carries its own light and dark palettes with no theme, and one with a theme", () => {
    expect(monogramSvg("Ada")).toContain("prefers-color-scheme:dark");
    expect(monogramSvg("Ada", "dark")).not.toContain("prefers-color-scheme");
    expect(monogramSvg("Ada", "dark")).toContain('fill="#1d2326"');
  });

  it("is what the server's initials style serves", () => {
    for (const theme of [undefined, "light", "dark"] as const) {
      expect(renderAvatar({ style: "initials", seed: "Ada L", theme })).toBe(
        monogramSvg("Ada L", theme),
      );
    }
  });
});
