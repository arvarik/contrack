/**
 * The generated brand assets.
 *
 * `public/` holds what `scripts/brand/build-icons.ts` writes, and nothing
 * else. The favicon is compared byte for byte with a fresh render, so an
 * edit to the paths without `npm run brand:icons` fails here rather than
 * shipping a tab-strip icon that disagrees with the sidebar. The model sheet
 * in `docs/brand` is held the same way, so the reference drawing of every
 * pose is always the rig's own.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  descriptionLine,
  renderFaviconSvg,
} from "../../scripts/brand/build-icons";
import { POSE_ROWS, renderPoseSheet } from "../../scripts/brand/poseSheet";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const exists = (file: string) => fs.existsSync(path.join(ROOT, file));

describe("the generated brand assets", () => {
  it("commits the favicon the script renders, byte for byte", () => {
    expect(read("public/favicon.svg")).toBe(renderFaviconSvg());
  });

  it("commits the model sheet the rig draws, byte for byte", () => {
    expect(read("docs/brand/corvid-poses.svg")).toBe(renderPoseSheet());
    expect(exists("docs/brand/corvid-poses.png")).toBe(true);
  });

  it("draws every pose of the sheet with one ring at most, and the ring unmoved", () => {
    const sheet = renderPoseSheet();
    const cells = POSE_ROWS.flatMap((row) => row.cells);
    expect(cells.length).toBeGreaterThanOrEqual(30);
    // Every cell has its eye, and no cell moves the ring: it is drawn with
    // the mark's own path data or not at all.
    expect(sheet.match(/<ellipse /g)).toHaveLength(cells.length);
    const rings = cells.filter((cell) => cell.ring).length;
    expect(sheet.split('<path d="M65.5 22.9 ').length - 1).toBe(rings);
  });

  it("keeps CSS variables and text out of the favicon", () => {
    const svg = renderFaviconSvg();
    expect(svg).not.toContain("var(");
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<title>Contrack</title>");
    expect(svg).toContain('aria-label="Contrack"');
    // The glyph: three parts and one eye.
    expect(svg.match(/<path /g)).toHaveLength(3);
    expect(svg.match(/<circle /g)).toHaveLength(1);
  });

  it("ships every file the manifest and index.html name", () => {
    const manifest = JSON.parse(read("public/site.webmanifest")) as {
      theme_color: string;
      icons: Array<{ src: string; purpose?: string; type: string }>;
    };
    expect(manifest.theme_color).toBe("#006a91");
    const maskable = manifest.icons.find((i) => i.purpose === "maskable");
    expect(maskable?.src).toBe("/icon-maskable-512.png");
    expect(manifest.icons.map((i) => i.src)).toContain("/favicon.svg?v=corvid");
    for (const icon of manifest.icons) {
      const file = icon.src.replace(/\?.*$/, "").replace(/^\//, "");
      expect(exists(path.join("public", file)), icon.src).toBe(true);
    }

    const html = read("index.html");
    expect(html).toContain('href="/favicon.svg?v=corvid"');
    expect(html).toContain('href="/apple-touch-icon.png?v=corvid"');
    expect(html).toContain('property="og:title" content="Contrack"');
    expect(html).toContain(
      'property="og:image" content="/og-image.png?v=corvid"',
    );
    expect(html).toMatch(/property="og:description"\s+content="[^"]+"/);
    for (const file of [
      "public/apple-touch-icon.png",
      "public/og-image.png",
      "docs/brand/corvid-mark.png",
      "docs/brand/corvid-source.jpg",
    ]) {
      expect(exists(file), file).toBe(true);
    }
  });

  it("leaves nothing but generated files and fonts in public/", () => {
    const allowed = new Set([
      "favicon.svg",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
      "apple-touch-icon.png",
      "og-image.png",
      "site.webmanifest",
      "theme-boot.js",
      "fonts",
    ]);
    for (const entry of fs.readdirSync(path.join(ROOT, "public"))) {
      if (entry.startsWith(".")) continue;
      expect(allowed.has(entry), `public/${entry}`).toBe(true);
    }
  });

  it("takes the first sentence of the description for the preview", () => {
    const html =
      '<meta name="description" content="Contrack — A self-hosted People CRM for x. Keyboard-first." />';
    expect(descriptionLine(html)).toBe("A self-hosted People CRM for x.");
    expect(descriptionLine(read("index.html"))).toBe(
      "A self-hosted People CRM for managing your personal and professional network.",
    );
  });
});
