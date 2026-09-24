/**
 * The corvid's geometry.
 *
 * The paths are hand-traced numbers, so the checks are the ones a number can
 * fail: every string parses as the two commands the parser accepts, the
 * glyph is a subset of the mark's parts, the ink keeps its padding inside
 * the box, the glyph lands inside the tile with the inset clear, the ring is
 * the one part that is not the bird, and the thinking head still turns
 * about the rig's neck.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BIRD_PART_ORDER,
  BRAND,
  CORVID_BOX,
  CORVID_EYE,
  CORVID_PART_ORDER,
  CORVID_PATHS,
  CORVID_RING,
  GLYPH_EYE_R,
  GLYPH_PARTS,
  GLYPH_STROKE,
  MARK_STROKE,
  TILE,
  fitGlyph,
  parsePath,
  pathBounds,
} from "../../src/assets/corvidPaths";
import { NECK } from "../../src/assets/corvidRig";

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

  it("lists every part once, in a drawing order that ends with the head", () => {
    expect([...CORVID_PART_ORDER].sort()).toEqual(
      Object.keys(CORVID_PATHS).sort(),
    );
    expect(new Set(CORVID_PART_ORDER).size).toBe(CORVID_PART_ORDER.length);
    expect(CORVID_PART_ORDER[CORVID_PART_ORDER.length - 1]).toBe("head");
  });

  it("has one part that is not the bird: the ring, drawn first", () => {
    expect(CORVID_RING).toBe("ring");
    expect(CORVID_PART_ORDER[0]).toBe(CORVID_RING);
    expect(BIRD_PART_ORDER).toEqual(CORVID_PART_ORDER.slice(1));
    expect(BIRD_PART_ORDER).not.toContain(CORVID_RING);
  });

  it("keeps the glyph a subset of the mark, without the chest or the tail", () => {
    for (const part of GLYPH_PARTS) expect(CORVID_PART_ORDER).toContain(part);
    expect(GLYPH_PARTS).toEqual(["ring", "head", "wing"]);
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
    const eye = pathBounds([CORVID_PATHS.head]);
    // The head line starts at x 27 and runs right of the eye's centre.
    expect(CORVID_EYE.cx).toBeGreaterThan(eye.minX);
    expect(CORVID_EYE.cx).toBeLessThan(eye.maxX);
    // Below the crown's top, above the beak's lower edge.
    const ring = pathBounds([CORVID_PATHS.ring]);
    expect(CORVID_EYE.cy - CORVID_EYE.r).toBeGreaterThan(ring.minY);
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

  it("turns the thinking head about the rig's neck", () => {
    // `transform-box: view-box` reads the origin in the mark's own box, so
    // the number in the stylesheet is a point of the drawing. Moving the
    // rig's neck without the keyframe would make the thinking bird nod
    // about some other point than the one every other head turn uses.
    const css = readFileSync("src/index.css", "utf8");
    const rule = css.match(
      /\.corvid-thinking \[data-part="head"\],\s*\.corvid-thinking \[data-part="eye"\]\s*\{[^}]*transform-box:\s*view-box;[^}]*transform-origin:\s*([\d.]+)px ([\d.]+)px/,
    );
    expect(rule, "no transform-origin on the thinking rule").toBeTruthy();
    expect(Number(rule![1])).toBe(NECK[0]);
    expect(Number(rule![2])).toBe(NECK[1]);
  });

  it("keeps the thinking keyframe off the ring", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).not.toMatch(/\.corvid-thinking\s*\{/);
    expect(css).not.toMatch(/data-part="ring"\][^{]*\{[^}]*animation/);
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
