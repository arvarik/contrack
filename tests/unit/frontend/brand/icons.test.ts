/**
 * The generated brand assets.
 *
 * `public/` holds what `scripts/brand/build-icons.ts` writes, and nothing
 * else, and `docs/brand/` holds the brand kit it writes. Every SVG the
 * script draws is compared byte for byte with a fresh render, so an edit to
 * the paths, the optical sizes or the fonts without `npm run brand:icons`
 * fails here rather than shipping an icon that disagrees with the sidebar.
 *
 * A raster's bytes depend on the libvips and librsvg that drew it, so the
 * rasters are held to what can be promised about them: each is the size
 * its name and its link say, the touch and maskable icons are opaque, the
 * icon file holds the three favicon frames, and the maskable icon's bird
 * keeps inside the circle a launcher may crop to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BLINK_EVERY,
  livingBird,
  loopPose,
  perchLoop,
} from "../../../../scripts/brand/animatedLockup";
import {
  MARK_VARIANTS,
  MASKABLE_SAFE_RADIUS,
  descriptionLine,
  icoFile,
  inkReach,
  maskableInset,
  renderAnimatedLockupSvg,
  renderAppIconSvg,
  renderCardSvg,
  renderLockupSvg,
  renderMarkSvg,
  type MarkVariant,
} from "../../../../scripts/brand/build-icons";
import {
  POSE_ROWS,
  renderPoseSheet,
} from "../../../../scripts/brand/poseSheet";
import { face, measure, outline, wrap } from "../../../../scripts/brand/type";
import {
  BIRD_PART_ORDER,
  BRAND,
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PATHS,
  TILE,
} from "../../../../src/assets/corvidPaths";
import { HOME_POSE, POSE_KEYS } from "../../../../src/assets/corvidRig";
import { BLINK_EVERY as BRAIN_BLINK_EVERY } from "../../../../src/lib/corvidBrain";
import type { Motion } from "../../../../src/lib/corvidMotion";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const file = (name: string) => path.join(ROOT, name);
const read = (name: string) => fs.readFileSync(file(name), "utf8");
const exists = (name: string) => fs.existsSync(file(name));
const size = async (name: string) => {
  const meta = await sharp(file(name)).metadata();
  return [meta.width, meta.height];
};
const opaque = async (name: string) =>
  (await sharp(file(name)).stats()).isOpaque;

/** The frames of a Windows icon file: each size and its PNG. */
function icoFrames(bytes: Buffer): { size: number; png: Buffer }[] {
  expect(bytes.readUInt16LE(0)).toBe(0);
  expect(bytes.readUInt16LE(2)).toBe(1);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => {
    const at = 6 + i * 16;
    const length = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    return {
      size: bytes.readUInt8(at) || 256,
      png: bytes.subarray(offset, offset + length),
    };
  });
}

const VARIANTS = Object.keys(MARK_VARIANTS) as MarkVariant[];

/** Every `<animate>` in an SVG, with the attributes of the element it moves. */
function animations(svg: string) {
  const found: {
    tag: string;
    rest: Record<string, string>;
    attribute: string;
    keyTimes: number[];
    values: string[];
  }[] = [];
  const elements = svg.matchAll(
    /<(path|ellipse)((?: [\w-]+="[^"]*")*)>\n((?:\s*<animate [^\n]*\/>\n)+)\s*<\/\1>/g,
  );
  for (const [, tag, attributes, children] of elements) {
    const rest = Object.fromEntries(
      [...attributes!.matchAll(/ ([\w-]+)="([^"]*)"/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    const animates = children!.matchAll(
      /<animate attributeName="([\w-]+)"[^\n]*? keyTimes="([^"]*)" values="([^"]*)" \/>/g,
    );
    for (const [, attribute, keyTimes, values] of animates) {
      found.push({
        tag: tag!,
        rest,
        attribute: attribute!,
        keyTimes: keyTimes!.split(";").map(Number),
        values: values!.split(";"),
      });
    }
  }
  return found;
}

describe("the brand kit's SVGs", () => {
  it("commits every mark, the app icon and the lockups the script draws, byte for byte", async () => {
    for (const variant of VARIANTS) {
      expect(read(`docs/brand/${variant}.svg`), variant).toBe(
        renderMarkSvg(variant),
      );
    }
    expect(read("docs/brand/corvid-app-icon.svg")).toBe(renderAppIconSvg());
    expect(read("docs/brand/contrack-lockup.svg")).toBe(
      await renderLockupSvg(false),
    );
    expect(read("docs/brand/contrack-lockup-dark.svg")).toBe(
      await renderLockupSvg(true),
    );
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

  it("keeps CSS variables and font lookups out of everything it renders", async () => {
    const svgs = [
      ...VARIANTS.map((variant) => renderMarkSvg(variant)),
      renderAppIconSvg(),
      await renderLockupSvg(false),
      await renderLockupSvg(true),
      await renderAnimatedLockupSvg(false),
      await renderAnimatedLockupSvg(true),
    ];
    for (const svg of svgs) {
      expect(svg).not.toContain("var(");
      // Words are outlines: no <text>, so no fallback face on any machine.
      expect(svg).not.toContain("<text");
      expect(svg).toContain("<title>Contrack</title>");
      expect(svg).toContain('aria-label="Contrack"');
    }
  });

  it("draws the logo at its own weight and the app icon at the launcher's", () => {
    const { large, medium } = CORVID_OPTICAL;
    for (const variant of VARIANTS) {
      const svg = renderMarkSvg(variant);
      expect(svg).toContain(`stroke-width="${large.stroke}"`);
      expect(svg.match(/<path /g)).toHaveLength(large.parts.length);
      expect(svg.match(/<circle /g)).toHaveLength(1);
    }
    const icon = renderAppIconSvg();
    expect(icon).toContain(`stroke-width="${medium.stroke}"`);
    expect(icon).toContain(`stop-color="${TILE.gradientTo}"`);
    expect(icon.match(/<path /g)).toHaveLength(medium.parts.length);
  });
});

describe("the living lockup", () => {
  const LIVING = ["contrack-lockup-animated", "contrack-lockup-animated-dark"];

  it("commits the animated lockups the script draws, byte for byte", async () => {
    expect(read("docs/brand/contrack-lockup-animated.svg")).toBe(
      await renderAnimatedLockupSvg(false),
    );
    expect(read("docs/brand/contrack-lockup-animated-dark.svg")).toBe(
      await renderAnimatedLockupSvg(true),
    );
  });

  it("draws the lockup's box, ring, pen and name, and moves only the bird", async () => {
    for (const dark of [false, true]) {
      const still = await renderLockupSvg(dark);
      const living = await renderAnimatedLockupSvg(dark);
      // Every line of the static lockup but its comment is here: the box,
      // the group's pen, the ring, the logo's bird and the name.
      const lines = new Set(living.split("\n").map((line) => line.trim()));
      for (const line of still.split("\n")) {
        if (line.includes("<!--")) continue;
        expect(lines.has(line.trim()), line.slice(0, 60)).toBe(true);
      }
      // One ring, never animated. Every animation is in the living bird.
      expect(living.split(`<path d="${CORVID_PATHS.ring}" />`)).toHaveLength(2);
      expect(living).not.toMatch(/<animate(Transform|Motion)/);
      const alive = living.slice(living.indexOf('<g class="alive">'));
      expect(alive.split("<animate ").length).toBe(
        living.split("<animate ").length,
      );
    }
  });

  it("starts and ends every animation on the logo, and holds it exactly between acts", async () => {
    const loop = perchLoop();
    for (const t of [0, loop.duration]) {
      const pose = loopPose(loop, t);
      for (const key of POSE_KEYS) expect(pose[key], key).toBe(HOME_POSE[key]);
    }
    // The middle of each still moment before an act, and after the last,
    // where no blink is playing either.
    const ends = [
      0,
      ...loop.acts.map(({ motion, start }) => start + motion.duration),
    ];
    const still = ends
      .map((end, i) => (end + (loop.acts[i]?.start ?? loop.duration)) / 2)
      .filter((t) =>
        loop.blinks.every(
          ({ motion, start }) => t < start || t > start + motion.duration,
        ),
      );
    expect(still.length).toBeGreaterThanOrEqual(3);

    const logo = new Set(BIRD_PART_ORDER.map((part) => CORVID_PATHS[part]));
    const eye: Record<string, string> = {
      cx: String(CORVID_EYE.cx),
      cy: String(CORVID_EYE.cy),
      rx: String(CORVID_EYE.r),
      ry: String(CORVID_EYE.r),
    };
    for (const dark of [false, true]) {
      const found = animations(await renderAnimatedLockupSvg(dark));
      // Every stroke moves, and the eye turns and blinks.
      expect(found.filter(({ tag }) => tag === "path")).toHaveLength(
        BIRD_PART_ORDER.length,
      );
      expect(found.filter(({ tag }) => tag === "ellipse")).toHaveLength(4);
      for (const { tag, rest, attribute, keyTimes, values } of found) {
        const home = rest[attribute]!;
        if (tag === "path") expect(logo.has(home), attribute).toBe(true);
        else expect(home, attribute).toBe(eye[attribute]);
        expect(values[0], attribute).toBe(home);
        expect(values.at(-1), attribute).toBe(home);
        expect(keyTimes[0]).toBe(0);
        expect(keyTimes.at(-1)).toBe(1);
        expect(values).toHaveLength(keyTimes.length);
        // In a still moment the keyframes either side are the logo's, so
        // the browser draws the logo and not a line that passes near it.
        for (const t of still) {
          const i = keyTimes.filter((time) => time <= t / loop.duration).length;
          expect(values[i - 1], `${attribute} at ${t}`).toBe(home);
          expect(values[i], `${attribute} at ${t}`).toBe(home);
        }
      }
    }
  });

  it("holds the bird still, as the logo, for a person who asked for reduced motion", async () => {
    const living = await renderAnimatedLockupSvg(false);
    expect(living).toMatch(
      /\.still \{ display: none; \}\s*@media \(prefers-reduced-motion: reduce\) \{\s*\.alive \{ display: none; \}\s*\.still \{ display: inline; \}/,
    );
    const still = living.slice(
      living.indexOf('<g class="still">'),
      living.indexOf('<g class="alive">'),
    );
    expect(still).not.toContain("<animate");
    for (const part of BIRD_PART_ORDER) {
      expect(still, part).toContain(`<path d="${CORVID_PATHS[part]}" />`);
    }
    expect(still).toContain(
      `<circle cx="${CORVID_EYE.cx}" cy="${CORVID_EYE.cy}" r="${CORVID_EYE.r}" fill="${BRAND.eyeLight}" stroke="none" />`,
    );
  });

  it("plays blinks, three looks about and three big acts, one at a time, in 20 to 30 seconds", () => {
    const loop = perchLoop();
    expect(loop.duration).toBeGreaterThanOrEqual(20_000);
    expect(loop.duration).toBeLessThanOrEqual(30_000);
    const names = loop.acts.map((cue) => cue.motion.name);
    expect(names).toEqual(
      expect.arrayContaining(["glance", "cock", "lookBack"]),
    );
    const big = names.filter((name) =>
      ["preen", "ruffle", "stretch", "caw", "hop"].includes(name),
    );
    expect(big).toHaveLength(3);
    // A still moment before each act, and after the last.
    let end = 0;
    for (const { motion, start } of loop.acts) {
      expect(start - end, motion.name).toBeGreaterThanOrEqual(1_000);
      end = start + motion.duration;
    }
    expect(loop.duration - end).toBeGreaterThanOrEqual(1_000);
    // Blinks on the brain's own clock, give or take the frame they start on.
    expect(BLINK_EVERY).toEqual(BRAIN_BLINK_EVERY);
    expect(loop.blinks.length).toBeGreaterThanOrEqual(3);
    loop.blinks.slice(1).forEach(({ start }, i) => {
      const gap = start - loop.blinks[i]!.start;
      expect(gap).toBeGreaterThan(BLINK_EVERY[0] - 17);
      expect(gap).toBeLessThan(BLINK_EVERY[1] + 17);
    });
    // The same seed, the same loop.
    expect(perchLoop()).toEqual(loop);
  });

  it("pads a stroke whose points change in number, and hides it while it is not drawn", () => {
    // The nape draws itself in as the bird leaves the ring, with more points
    // frame by frame. No perched act draws it, so this loop is made up.
    const motion: Motion = {
      name: "flutter",
      duration: 600,
      tracks: {
        nape: [
          { at: 0, value: 0 },
          { at: 300, value: 1 },
          { at: 600, value: 0 },
        ],
      },
    };
    const lines = livingBird("#000000", "", {
      acts: [{ motion, start: 200 }],
      blinks: [],
      duration: 1_000,
    });
    const nape = animations(lines.join("\n")).filter(
      ({ rest }) => rest.visibility === "hidden",
    );
    const d = nape.find(({ attribute }) => attribute === "d")!;
    const visibility = nape.find(
      ({ attribute }) => attribute === "visibility",
    )!;
    // One list of commands in every keyframe, so the browser can morph it.
    const commands = new Set(d.values.map((v) => v.replace(/[^MC]/g, "")));
    expect([...commands]).toEqual(["MCCCCCC"]);
    expect(visibility.values).toEqual(["hidden", "visible", "hidden"]);
  });

  it("keeps each file under 150 KB, for the first image the README loads", () => {
    for (const name of LIVING) {
      const bytes = fs.statSync(file(`docs/brand/${name}.svg`)).size;
      expect(bytes, name).toBeLessThan(150_000);
    }
  });
});

describe("the favicons", () => {
  it("draws one picture per pixel size, and bundles the three in favicon.ico", async () => {
    expect(await size("public/favicon-16.png")).toEqual([16, 16]);
    expect(await size("public/favicon-32.png")).toEqual([32, 32]);
    expect(await size("public/favicon-48.png")).toEqual([48, 48]);
    const frames = icoFrames(fs.readFileSync(file("public/favicon.ico")));
    expect(frames.map((frame) => frame.size)).toEqual([16, 32, 48]);
    for (const frame of frames) {
      const meta = await sharp(frame.png).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([frame.size, frame.size]);
    }
    // The frames are the PNGs the page links, not a second drawing.
    frames.forEach((frame) => {
      const linked = fs.readFileSync(file(`public/favicon-${frame.size}.png`));
      expect(frame.png.equals(linked), `${frame.size}`).toBe(true);
    });
  });

  it("links every size in index.html, and no SVG favicon to win over them", () => {
    const html = read("index.html");
    for (const px of [16, 32, 48]) {
      expect(html).toMatch(
        new RegExp(
          `rel="icon"\\s+type="image/png"\\s+sizes="${px}x${px}"\\s+href="/favicon-${px}\\.png\\?v=`,
        ),
      );
    }
    expect(html).toContain('href="/favicon.ico?v=');
    expect(html).not.toContain("image/svg+xml");
    expect(html).not.toContain("favicon.svg");
  });
});

describe("the app icons", () => {
  it("sizes each icon as its name says", async () => {
    expect(await size("public/apple-touch-icon.png")).toEqual([180, 180]);
    expect(await size("public/icon-192.png")).toEqual([192, 192]);
    expect(await size("public/icon-512.png")).toEqual([512, 512]);
    expect(await size("public/icon-maskable-192.png")).toEqual([192, 192]);
    expect(await size("public/icon-maskable-512.png")).toEqual([512, 512]);
    expect(await size("docs/brand/corvid-app-icon-1024.png")).toEqual([
      1024, 1024,
    ]);
  });

  it("fills the touch and maskable icons to the edge, with nothing see-through", async () => {
    // iOS fills transparency with black, and a launcher masks what it is given.
    expect(await opaque("public/apple-touch-icon.png")).toBe(true);
    expect(await opaque("public/icon-maskable-192.png")).toBe(true);
    expect(await opaque("public/icon-maskable-512.png")).toBe(true);
    // The launcher icons keep the tile's own rounded corners.
    expect(await opaque("public/icon-512.png")).toBe(false);
  });

  it("keeps the maskable icon's bird inside the circle a launcher may crop to", () => {
    const { medium } = CORVID_OPTICAL;
    const inset = maskableInset(medium);
    const limit = MASKABLE_SAFE_RADIUS * TILE.box;
    expect(inkReach(medium, inset)).toBeLessThanOrEqual(limit);
    // And no further in than it has to be: a hundredth less spills.
    expect(inkReach(medium, inset - 0.02)).toBeGreaterThan(limit);
  });

  it("ships every file the manifest names, with an icon for each purpose and size", async () => {
    const manifest = JSON.parse(read("public/site.webmanifest")) as {
      theme_color: string;
      background_color: string;
      icons: Array<{
        src: string;
        sizes: string;
        purpose?: string;
        type: string;
      }>;
    };
    // The page's own surface, as its theme-color meta says: an installed
    // app's title bar and splash do not flash the accent.
    expect(manifest.theme_color).toBe(BRAND.surface);
    expect(manifest.background_color).toBe(BRAND.surface);
    const listed = manifest.icons.map(
      (icon) => `${icon.purpose}:${icon.sizes}`,
    );
    expect(listed.sort()).toEqual([
      "any:192x192",
      "any:512x512",
      "maskable:192x192",
      "maskable:512x512",
    ]);
    for (const icon of manifest.icons) {
      const name = icon.src.replace(/\?.*$/, "").replace(/^\//, "");
      expect(exists(path.join("public", name)), icon.src).toBe(true);
      expect(icon.type).toBe("image/png");
      expect(icon.src).toContain("?v=");
      const [w, h] = await size(path.join("public", name));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe("the link preview and the kit's images", () => {
  it("sizes the cards as the platforms ask", async () => {
    expect(await size("public/og-image.png")).toEqual([1200, 630]);
    expect(await size("docs/brand/social-preview.png")).toEqual([1280, 640]);
    expect(await opaque("public/og-image.png")).toBe(true);
    expect(await opaque("docs/brand/social-preview.png")).toBe(true);
  });

  it("names the link preview's image, its size and what it shows", () => {
    const html = read("index.html");
    expect(html).toContain('property="og:title" content="Contrack"');
    expect(html).toMatch(
      /property="og:image" content="\/og-image\.png\?v=[^"]+"/,
    );
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toMatch(/property="og:image:alt"\s+content="[^"]+"/);
    expect(html).toMatch(/property="og:description"\s+content="[^"]+"/);
  });

  it("renders the lockups at the size their SVGs say", async () => {
    for (const name of ["contrack-lockup", "contrack-lockup-dark"]) {
      const svg = read(`docs/brand/${name}.svg`);
      const [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/)!;
      expect(await size(`docs/brand/${name}.png`), name).toEqual([
        Math.round(Number(w)),
        Math.round(Number(h)),
      ]);
    }
    expect(await size("docs/brand/corvid-mark.png")).toEqual([512, 512]);
    expect(await size("docs/brand/corvid-mark-dark.png")).toEqual([512, 512]);
    for (const sheet of ["corvid-optical-sizes", "corvid-mark-variants"]) {
      expect(exists(`docs/brand/${sheet}.png`), sheet).toBe(true);
    }
    expect(exists("docs/brand/corvid-source.jpg")).toBe(true);
    expect(exists("docs/brand/README.md")).toBe(true);
  });

  it("heads the README with the living lockup, and a dark one for a dark page", () => {
    const readme = read("README.md");
    const header = readme.slice(0, readme.indexOf("</h1>"));
    expect(header).toContain(
      '<source media="(prefers-color-scheme: dark)" srcset="docs/brand/contrack-lockup-animated-dark.svg" />',
    );
    expect(header).toContain(
      '<img src="docs/brand/contrack-lockup-animated.svg" alt="Contrack" width="400" />',
    );
  });

  it("leaves nothing but generated files and fonts in public/", () => {
    const allowed = new Set([
      "favicon-16.png",
      "favicon-32.png",
      "favicon-48.png",
      "favicon.ico",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-192.png",
      "icon-maskable-512.png",
      "apple-touch-icon.png",
      "og-image.png",
      "site.webmanifest",
      "theme-boot.js",
      "fonts",
    ]);
    for (const entry of fs.readdirSync(file("public"))) {
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

describe("the words in the brand images", () => {
  it("sets the name in the app's own face, as wide as Chromium sets it", async () => {
    // "Contrack" at 128 px, Manrope at 800, tracked -0.025 em, measures
    // 559.75 px in Chromium. A change of weight, tracking or font file moves
    // it, and the images would no longer match the page.
    const width = measure(await face("name"), "Contrack", 128, -0.025);
    expect(width).toBeGreaterThan(559.2);
    expect(width).toBeLessThan(560.2);
  });

  it("outlines a line, with its ink above the baseline and its pen past it", async () => {
    const line = outline(await face("body"), "Contrack", 32);
    expect(line.d).toMatch(/^M[-\d.]+ [-\d.]+/);
    expect(line.ink.top).toBeLessThan(0);
    expect(line.ink.left).toBeGreaterThanOrEqual(0);
    expect(line.advance).toBeGreaterThan(line.ink.right);
  });

  it("breaks the description into lines no wider than asked, losing no word", async () => {
    const body = await face("body");
    const text =
      "A self-hosted People CRM for managing your personal and professional network.";
    const lines = wrap(body, text, 32, 680);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) {
      expect(measure(body, line, 32)).toBeLessThanOrEqual(680);
    }
  });
});

describe("the link cards", () => {
  it("draws the app icon, the name and the line on the app's surface, in outlines", async () => {
    const svg = await renderCardSvg(
      1200,
      630,
      descriptionLine(read("index.html")),
    );
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain(`fill="${BRAND.surface}"`);
    expect(svg).toContain(`stop-color="${TILE.gradientTo}"`);
    expect(svg).toContain(`stroke-width="${CORVID_OPTICAL.medium.stroke}"`);
    // The name, then two lines of the description, all as paths.
    expect(
      svg.match(new RegExp(`fill="${BRAND.onSurface}"`, "g")),
    ).toHaveLength(1);
    expect(
      svg.match(new RegExp(`fill="${BRAND.onSurfaceVariant}"`, "g")),
    ).toHaveLength(2);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("var(");
  });
});

describe("the icon file", () => {
  it("writes a directory entry for each frame, pointing at its PNG", () => {
    const one = Buffer.from("first frame");
    const two = Buffer.from("the second frame");
    const bytes = icoFile([
      { size: 16, png: one },
      { size: 256, png: two },
    ]);
    const frames = icoFrames(bytes);
    // 256 is written as 0, as the format asks, and read back as 256.
    expect(frames.map((frame) => frame.size)).toEqual([16, 256]);
    expect(frames[0]!.png.equals(one)).toBe(true);
    expect(frames[1]!.png.equals(two)).toBe(true);
    expect(bytes.readUInt16LE(6 + 4)).toBe(1);
    expect(bytes.readUInt16LE(6 + 6)).toBe(32);
    expect(bytes.length).toBe(6 + 2 * 16 + one.length + two.length);
  });
});
