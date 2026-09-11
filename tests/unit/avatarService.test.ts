// =============================================================================
// Unit: avatar generation
// =============================================================================
// The two things worth guarding here are the two that fail silently:
//
//   1. An option value DiceBear does not recognise is ignored, not rejected.
//      So a typo in an allow-list would quietly restore the full expression
//      pool — angry eyebrows and all — with nothing observable at runtime.
//      Hence the schema-conformance tests below.
//   2. Avatars must be deterministic. If they were not, every contact's face
//      would change on every render, which no one would file as a bug but
//      everyone would find unsettling.
// =============================================================================

import { describe, it, expect } from "vitest";
import { schema as avataaarsSchema } from "@dicebear/avataaars";
import {
  AVATAR_STYLES,
  BANNED_EXPRESSIONS,
  FRIENDLY_EYEBROWS,
  FRIENDLY_EYES,
  FRIENDLY_MOUTH,
  buildAvatarUrl,
  isAvatarStyle,
  isAvatarTheme,
  renderAvatar,
  type AvatarStyle,
} from "../../server/services/avatarService.ts";

/** Pull the permitted values for an avataaars option out of its own schema. */
function schemaEnum(option: string): string[] {
  const property = (
    avataaarsSchema as unknown as {
      properties: Record<string, { items?: { enum?: string[] } }>;
    }
  ).properties[option];
  const values = property?.items?.enum;
  expect(values, `avataaars schema has no enum for "${option}"`).toBeDefined();
  return values!;
}

describe("expression allow-lists", () => {
  const cases: [string, readonly string[]][] = [
    ["eyebrows", FRIENDLY_EYEBROWS],
    ["eyes", FRIENDLY_EYES],
    ["mouth", FRIENDLY_MOUTH],
  ];

  it.each(cases)(
    "every permitted %s value exists in DiceBear's schema",
    (option, allowed) => {
      const valid = schemaEnum(option);
      for (const value of allowed) {
        expect(valid, `"${value}" is not a real ${option} value`).toContain(
          value,
        );
      }
    },
  );

  it.each(cases)("no banned %s value is permitted", (option, allowed) => {
    const banned =
      BANNED_EXPRESSIONS[option as keyof typeof BANNED_EXPRESSIONS];
    for (const value of banned) {
      expect(allowed, `"${value}" must never appear on a face`).not.toContain(
        value,
      );
    }
  });

  it("bans every unfriendly value the schema actually offers", () => {
    // Guards the reverse direction: if DiceBear adds a new scowl, the
    // allow-list still excludes it, but this documents what we reviewed.
    const reviewed = new Set<string>([
      ...FRIENDLY_EYEBROWS,
      ...BANNED_EXPRESSIONS.eyebrows,
    ]);
    for (const value of schemaEnum("eyebrows")) {
      expect(
        reviewed.has(value),
        `eyebrow "${value}" is neither permitted nor banned — review it`,
      ).toBe(true);
    }
  });
});

describe("renderAvatar", () => {
  it.each(AVATAR_STYLES)("renders %s as an SVG document", (style) => {
    const svg = renderAvatar({ style, seed: "Karen White" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.length).toBeGreaterThan(200);
  });

  it("is deterministic — the same seed always yields the same face", () => {
    const once = renderAvatar({ style: "avataaars", seed: "Karen White" });
    const twice = renderAvatar({ style: "avataaars", seed: "Karen White" });
    expect(once).toBe(twice);
  });

  it("gives different people different faces", () => {
    const a = renderAvatar({ style: "avataaars", seed: "Karen White" });
    const b = renderAvatar({ style: "avataaars", seed: "James Thomas" });
    expect(a).not.toBe(b);
  });

  it("applies the pastel background only when asked", () => {
    const plain = renderAvatar({ style: "lorelei", seed: "Ada" });
    const washed = renderAvatar({
      style: "lorelei",
      seed: "Ada",
      background: true,
    });
    expect(washed).not.toBe(plain);
  });

  it("falls back instead of throwing when a style cannot render", () => {
    // A style name that survived the type system (e.g. a stale persisted URL
    // hand-edited in the database) must degrade, not 500.
    const svg = renderAvatar({
      style: "not-a-style" as AvatarStyle,
      seed: "Karen White",
    });
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("survives seeds that are not names", () => {
    for (const seed of ["", " ", "123", "🙂", "<script>", "a".repeat(200)]) {
      const svg = renderAvatar({ style: "avataaars", seed });
      expect(svg.startsWith("<svg")).toBe(true);
    }
  });

  it("escapes XML metacharacters rather than emitting broken markup", () => {
    // Reaches the hand-built monogram, the one path with no library escaping.
    const svg = renderAvatar({
      style: "not-a-style" as AvatarStyle,
      seed: "<Bobby> & Tables",
    });
    expect(svg).not.toMatch(/>\s*<Bobby/);
  });
});

describe("buildAvatarUrl", () => {
  it("is same-origin — no contact name ever leaves the machine", () => {
    const url = buildAvatarUrl("Karen White");
    expect(url.startsWith("/api/avatar/")).toBe(true);
    expect(url).not.toContain("dicebear");
    expect(url).not.toContain("http");
  });

  it("encodes seeds that would otherwise break the query string", () => {
    const url = buildAvatarUrl("Ann & Bob #1");
    expect(url).toContain("seed=Ann+%26+Bob+%231");
    expect(new URLSearchParams(url.split("?")[1]).get("seed")).toBe(
      "Ann & Bob #1",
    );
  });

  it("requests the pastel wash only on demand", () => {
    expect(buildAvatarUrl("Ada")).not.toContain("bg=1");
    expect(buildAvatarUrl("Ada", "lorelei", { background: true })).toContain(
      "bg=1",
    );
  });
});

describe("drawing for a dark palette", () => {
  // An avatar is served as an image, so no page stylesheet reaches inside it.
  // A monogram built from the light palette's surface is a pale square in the
  // middle of a dark card — the one avatar case that actually breaks, because
  // it is the only style that paints a background of its own by default.

  it("answers both palettes when no theme is named", () => {
    // The default `system` theme needs no parameter at all: the SVG carries
    // its own media query, which is right on both and costs no cache split.
    const svg = renderAvatar({ style: "initials", seed: "Ada Lovelace" });
    expect(svg).toContain("prefers-color-scheme:dark");
    expect(svg).toContain("var(--bg)");
    expect(svg).toContain("var(--fg)");
  });

  it("pins the colours when a theme is named", () => {
    const light = renderAvatar({
      style: "initials",
      seed: "Ada Lovelace",
      theme: "light",
    });
    const dark = renderAvatar({
      style: "initials",
      seed: "Ada Lovelace",
      theme: "dark",
    });

    expect(light).toContain("#e8eff1");
    expect(light).not.toContain("prefers-color-scheme");
    expect(dark).toContain("#1d2326");
    expect(dark).not.toContain("#e8eff1");
    expect(dark).not.toContain("prefers-color-scheme");
    // Same letters either way.
    expect(light).toContain(">AL<");
    expect(dark).toContain(">AL<");
  });

  it("uses a deeper wash for the picker grid in dark", () => {
    const light = renderAvatar({
      style: "avataaars",
      seed: "Grace Hopper",
      background: true,
      theme: "light",
    });
    const dark = renderAvatar({
      style: "avataaars",
      seed: "Grace Hopper",
      background: true,
      theme: "dark",
    });
    expect(light).not.toBe(dark);
  });

  it("keeps the theme out of the URL unless it is asked for", () => {
    // The picker saves this URL onto the contact, so a theme in it would pin
    // that person's avatar to one palette for every viewer for ever.
    expect(buildAvatarUrl("Ada", "initials")).not.toContain("theme");
    expect(buildAvatarUrl("Ada", "initials", { theme: "dark" })).toContain(
      "theme=dark",
    );
  });

  it("accepts only the two palettes", () => {
    expect(isAvatarTheme("light")).toBe(true);
    expect(isAvatarTheme("dark")).toBe(true);
    for (const value of ["", "DARK", "sepia", null, undefined, 1]) {
      expect(isAvatarTheme(value), String(value)).toBe(false);
    }
  });
});

describe("isAvatarStyle", () => {
  it("accepts the offered styles and rejects anything else", () => {
    for (const style of AVATAR_STYLES) expect(isAvatarStyle(style)).toBe(true);
    for (const style of ["", "pixel-art", "../../etc/passwd", "AVATAAARS"]) {
      expect(isAvatarStyle(style)).toBe(false);
    }
  });
});
