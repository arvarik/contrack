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

describe("isAvatarStyle", () => {
  it("accepts the offered styles and rejects anything else", () => {
    for (const style of AVATAR_STYLES) expect(isAvatarStyle(style)).toBe(true);
    for (const style of ["", "pixel-art", "../../etc/passwd", "AVATAAARS"]) {
      expect(isAvatarStyle(style)).toBe(false);
    }
  });
});
