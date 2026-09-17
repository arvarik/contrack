/**
 * The corvid's geometry.
 *
 * The paths are hand-traced numbers, so the checks are the ones a number can
 * fail: every string parses as the two commands the parser accepts, the
 * glyph is a subset of the mark's parts, the ink keeps its padding inside
 * the box, and the glyph lands inside the tile with the inset clear.
 */
import { describe, expect, it } from "vitest";
import {
  BRAND,
  CORVID_BOX,
  CORVID_EYE,
  CORVID_PART_ORDER,
  CORVID_PATHS,
  GLYPH_EYE_R,
  GLYPH_PARTS,
  GLYPH_STROKE,
  MARK_STROKE,
  TILE,
  fitGlyph,
  parsePath,
  pathBounds,
} from "../../src/assets/corvidPaths";

const ALL_PATHS = CORVID_PART_ORDER.map((part) => CORVID_PATHS[part]);

describe("the corvid's paths", () => {
  it("parse as absolute M and C commands and nothing else", () => {
    for (const part of CORVID_PART_ORDER) {
      const d = CORVID_PATHS[part];
      expect(d.startsWith("M"), part).toBe(true);
      for (const token of d.split(" ")) {
        expect(token, `${part}: ${token}`).toMatch(/^[MC]?-?\d+(\.\d+)?$/);
      }
      const commands = parsePath(d);
      expect(commands[0]!.cmd).toBe("M");
      for (const command of commands) {
        expect(command.points).toHaveLength(command.cmd === "M" ? 1 : 3);
      }
      // A part is a curve, not a dot.
      expect(commands.filter((c) => c.cmd === "C").length).toBeGreaterThan(3);
    }
  });

  it("rejects a relative or unknown command", () => {
    expect(() => parsePath("M1 1 c1 1 2 2 3 3")).toThrow(/Unsupported/);
    expect(() => parsePath("M1 1 L2 2")).toThrow(/Unsupported/);
    expect(() => parsePath("M1 1 C1 1 2 2")).toThrow(/Short/);
    expect(() => parsePath("M1 1 C1 1 2 2 3 x")).toThrow(/Bad number/);
  });

  it("lists every part once, in a drawing order that ends with the beak", () => {
    expect([...CORVID_PART_ORDER].sort()).toEqual(
      Object.keys(CORVID_PATHS).sort(),
    );
    expect(new Set(CORVID_PART_ORDER).size).toBe(CORVID_PART_ORDER.length);
    expect(CORVID_PART_ORDER[CORVID_PART_ORDER.length - 1]).toBe("beak");
  });

  it("keeps the glyph a subset of the mark, without the chest or the tail", () => {
    for (const part of GLYPH_PARTS) expect(CORVID_PART_ORDER).toContain(part);
    expect(GLYPH_PARTS).toEqual(["body", "beak", "wing"]);
    expect(GLYPH_STROKE).toBeGreaterThan(MARK_STROKE);
    expect(GLYPH_EYE_R).toBeGreaterThanOrEqual(CORVID_EYE.r);
  });

  it("keeps the ink inside the box, 8 units from the sides", () => {
    const ink = pathBounds(ALL_PATHS, MARK_STROKE);
    expect(ink.minX).toBeGreaterThanOrEqual(0);
    expect(ink.minY).toBeGreaterThanOrEqual(0);
    expect(ink.maxX).toBeLessThanOrEqual(CORVID_BOX);
    expect(ink.maxY).toBeLessThanOrEqual(CORVID_BOX);
    // The bird is wider than tall, so the sides carry the padding exactly
    // and the top and bottom carry more.
    expect(ink.minX).toBeGreaterThanOrEqual(7.7);
    expect(ink.minX).toBeLessThanOrEqual(8.3);
    expect(ink.maxX).toBeGreaterThanOrEqual(91.7);
    expect(ink.maxX).toBeLessThanOrEqual(92.3);
    expect(ink.minY).toBeGreaterThanOrEqual(8);
    expect(ink.maxY).toBeLessThanOrEqual(92);
    // Centred top to bottom.
    expect(ink.minY + ink.maxY).toBeCloseTo(CORVID_BOX, 0);
  });

  it("puts the eye in the head, between the crown and the head line", () => {
    const eye = pathBounds([CORVID_PATHS.beak]);
    // The head line starts at x 27 and runs right of the eye's centre.
    expect(CORVID_EYE.cx).toBeGreaterThan(eye.minX);
    expect(CORVID_EYE.cx).toBeLessThan(eye.maxX);
    // Below the crown's top, above the beak's lower edge.
    const crown = pathBounds([CORVID_PATHS.body]);
    expect(CORVID_EYE.cy - CORVID_EYE.r).toBeGreaterThan(crown.minY);
    expect(CORVID_EYE.cy + CORVID_EYE.r).toBeLessThan(eye.maxY);
  });

  it("places the glyph inside the tile with the inset clear on every side", () => {
    const { scale, tx, ty } = fitGlyph(TILE.box, TILE.glyphInset);
    const ink = pathBounds(
      GLYPH_PARTS.map((part) => CORVID_PATHS[part]),
      GLYPH_STROKE,
    );
    const left = ink.minX * scale + tx;
    const right = ink.maxX * scale + tx;
    const top = ink.minY * scale + ty;
    const bottom = ink.maxY * scale + ty;
    // The placement rounds to three decimals, so allow a tenth of a unit.
    expect(left).toBeGreaterThanOrEqual(TILE.glyphInset - 0.1);
    expect(right).toBeLessThanOrEqual(TILE.box - TILE.glyphInset + 0.1);
    expect(top).toBeGreaterThanOrEqual(TILE.glyphInset - 0.1);
    expect(bottom).toBeLessThanOrEqual(TILE.box - TILE.glyphInset + 0.1);
    // The wider axis fills the room, and the glyph is centred on the other.
    expect(right - left).toBeCloseTo(TILE.box - 2 * TILE.glyphInset, 1);
    expect(top + bottom).toBeCloseTo(TILE.box, 1);
  });

  it("copies the brand literals from the light palette", () => {
    expect(BRAND.mark).toBe("#006a91");
    expect(BRAND.eyeLight).toBe("#47befd");
    expect(BRAND.eyeDark).toBe("#7fd6ff");
    expect(TILE.eye).toBe(BRAND.eyeLight);
    expect(TILE.gradientTo).toBe("#47befd");
    expect(TILE.gradientFrom).toBe("#00628a");
  });
});
