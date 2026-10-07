// The contrast gate for both palettes and every accent somebody can pick.
//
// `scripts/contrast-audit.mjs` measures the live DOM, but it needs Chrome and a
// running server, so it cannot gate a pull request. This test can. It checks:
//
//   1. `src/index.css` and `src/lib/theme.ts` hold the same palettes. The
//      derivation reads the surfaces from the TypeScript copy.
//   2. The dark palette clears WCAG AA everywhere the light one does.
//   3. Every accent a person can choose clears it: 6,000 colors across the hue
//      circle, in both palettes. That is what makes a color picker safe.
//
// One pairing is excluded by name: `text-primary` on a `bg-primary/15` or `/20`
// wash, which the light primary does not clear. `--color-on-primary-wash`
// carries text there. The last block checks that the wash token clears every
// alpha and the primary does not, and a source scan keeps the two apart.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AA,
  DEFAULT_ACCENT,
  deriveAccent,
  deriveWashText,
  LIGHT,
  DARK,
  PALETTES,
  PILL_SURFACES,
  WASH_ALPHA,
  WASH_ALPHAS,
  type Palette,
  type ResolvedMode,
} from "../../../../src/lib/theme";
import {
  contrast,
  hexToRgb,
  oklchToRgb,
  over,
  rgbToHex,
  rgbToOklch,
} from "../../../../src/lib/color";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(
  path.join(here, "../../../../src/index.css"),
  "utf8",
);

/**
 * Surfaces a piece of text can land on. `surface-variant` is left out because
 * `bg-surface-variant` appears nowhere in the app.
 */
const SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
] as const;

/** Every token used as text or as an icon, with its usage count in the app. */
const TEXT_TOKENS = [
  "on-surface",
  "on-surface-variant",
  "primary",
  "secondary",
  "success",
  "warning",
  "info",
  "error",
  "ai",
] as const;

/**
 * Alphas each token's own wash is enforced at. `primary` stops at 0.10, the
 * heaviest wash `text-primary` may sit on. Heavier washes carry
 * `text-on-primary-wash`, which the last block holds to the full set.
 */
const ENFORCED_WASH_ALPHAS: Partial<
  Record<(typeof TEXT_TOKENS)[number], number[]>
> = {
  primary: [0.1],
  // The note glyph and the AI chip icon sit on `bg-ai/10`.
  ai: [0.1],
  error: [0.1],
  warning: [0.1],
  // The tones (`TONE_WASH` in src/lib/styles.ts): new people on Pulse wear
  // the success ink on its own wash.
  success: [0.1],
  // The timeline's call and social glyphs sit on the info wash.
  info: [0.1],
};

/** Every alpha `bg-primary/*` is written at in the app. */
const ALL_PRIMARY_ALPHAS = [...WASH_ALPHAS];

/** Text painted directly on a filled token. */
const FILLS: [keyof Palette, keyof Palette][] = [
  ["on-primary", "primary"],
  ["on-error", "error"],
];

/** Every (text, background) pair one palette has to answer for. */
function casesFor(palette: Palette, alphas = ENFORCED_WASH_ALPHAS) {
  const cases: { label: string; ratio: number }[] = [];

  for (const token of TEXT_TOKENS) {
    const fg = hexToRgb(palette[token]);
    for (const surface of SURFACES) {
      cases.push({
        label: `${token} on ${surface}`,
        ratio: contrast(fg, hexToRgb(palette[surface])),
      });
    }
    for (const alpha of alphas[token] ?? []) {
      for (const surface of PILL_SURFACES) {
        cases.push({
          label: `${token} on ${token}/${alpha * 100} over ${surface}`,
          ratio: contrast(fg, over(fg, alpha, hexToRgb(palette[surface]))),
        });
      }
    }
  }

  for (const [fg, bg] of FILLS) {
    cases.push({
      label: `${fg} on ${bg}`,
      ratio: contrast(hexToRgb(palette[fg]), hexToRgb(palette[bg])),
    });
  }

  return cases;
}

// 1. The two files agree

/** Pull one `--color-*` block out of the stylesheet. */
function tokensFrom(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim().toLowerCase();
  }
  return out;
}

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `"${marker}" is not in index.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  // Good enough for a flat block of custom properties, which is all these are.
  const end = css.indexOf("\n}", open);
  return css.slice(open, end);
}

describe("index.css and theme.ts hold the same palettes", () => {
  it("declares every light token with the value theme.ts uses", () => {
    const declared = tokensFrom(blockAfter("@theme {"));
    for (const [token, value] of Object.entries(LIGHT)) {
      expect(declared[token], `--color-${token}`).toBe(value.toLowerCase());
    }
  });

  it("declares every dark token with the value theme.ts uses", () => {
    const declared = tokensFrom(blockAfter(':root[data-theme="dark"] {'));
    for (const [token, value] of Object.entries(DARK)) {
      expect(declared[token], `--color-${token}`).toBe(value.toLowerCase());
    }
  });

  it("repeats the dark palette for the system-preference case", () => {
    // Two blocks, because "dark because the machine says so" and "dark because
    // somebody chose it" are different selectors. A palette written into one
    // and not the other is a theme that works only when it is chosen.
    const chosen = tokensFrom(blockAfter(':root[data-theme="dark"] {'));
    const system = tokensFrom(blockAfter(':root:not([data-theme="light"]) {'));
    expect(system).toEqual(chosen);
  });

  it("defines a color scheme for both palettes", () => {
    // Without it the browser paints scrollbars, form controls and the canvas
    // behind the page from its own default, which does not follow the tokens.
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light;/);
    expect(css).toMatch(
      /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/,
    );
    expect(css).toMatch(
      /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/,
    );
  });

  it("gives the frosted panel a dark value", () => {
    // The one literal that no token describes. The components layer sets the
    // light one, and the dark one is set twice outside it: once for a dark
    // machine and once for a chosen dark theme.
    const backgrounds = (text: string) =>
      [
        ...text.matchAll(
          /\.glass-panel\s*\{[^}]*?background-color:\s*([^;]+);/g,
        ),
      ].map((match) => match[1].trim());
    const layer = blockAfter("@layer components {");
    const light = backgrounds(layer);
    const dark = backgrounds(css.replace(layer, ""));
    expect(light).toHaveLength(1);
    expect(dark).toHaveLength(2);
    expect(dark[1]).toBe(dark[0]);
    expect(dark[0]).not.toBe(light[0]);
  });
});

// 2. Both palettes clear AA

describe.each(["light", "dark"] as const)("the %s palette", (mode) => {
  const cases = casesFor(PALETTES[mode]);

  it("checks more than sixty color pairs", () => {
    // A gate that silently stopped generating cases would pass everything.
    expect(cases.length).toBeGreaterThan(60);
  });

  it("clears WCAG AA on every one of them", () => {
    const failures = cases
      .filter((c) => c.ratio < AA)
      .map((c) => `${c.label}: ${c.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});

describe("the dark palette is not the sloppier of the two", () => {
  it("is at least as readable as the light one, pair for pair", () => {
    // Including the heavier washes the light palette does not clear. The dark
    // palette must not inherit a problem it does not have.
    const alphas = {
      primary: ALL_PRIMARY_ALPHAS,
      error: [0.1],
      warning: [0.1],
      success: [0.1],
      info: [0.1],
    };
    const light = casesFor(LIGHT, alphas);
    const dark = casesFor(DARK, alphas);
    expect(dark.map((c) => c.label)).toEqual(light.map((c) => c.label));

    const worse = dark
      .map((c, i) => ({ label: c.label, dark: c.ratio, light: light[i].ratio }))
      // A tenth of a ratio point is measurement noise, not a regression.
      .filter((c) => c.dark < Math.min(c.light, AA) - 0.1)
      .map(
        (c) =>
          `${c.label}: dark ${c.dark.toFixed(2)} < light ${c.light.toFixed(2)}`,
      );
    expect(worse).toEqual([]);
  });
});

// 3. Every accent somebody can pick

/** The worst contrast `text-primary` reaches for a given primary. */
function worstPrimary(primaryHex: string, mode: ResolvedMode): number {
  const palette = PALETTES[mode];
  const fg = hexToRgb(primaryHex);
  let worst = Infinity;
  for (const surface of SURFACES) {
    worst = Math.min(worst, contrast(fg, hexToRgb(palette[surface])));
  }
  for (const surface of PILL_SURFACES) {
    for (const alpha of [0.1, WASH_ALPHA, 0.2]) {
      worst = Math.min(
        worst,
        contrast(fg, over(fg, alpha, hexToRgb(palette[surface]))),
      );
    }
  }
  return worst;
}

describe("deriveAccent", () => {
  /** The whole hue circle, five chromas, five lightnesses, both palettes. */
  const sweep: { hex: string; mode: ResolvedMode }[] = [];
  for (let h = 0; h < 360; h += 3) {
    for (const c of [0.02, 0.08, 0.15, 0.25, 0.37]) {
      for (const l of [0.15, 0.35, 0.55, 0.75, 0.95]) {
        const hex = rgbToHex(oklchToRgb({ l, c, h }));
        sweep.push({ hex, mode: "light" }, { hex, mode: "dark" });
      }
    }
  }

  it("never produces a primary that fails AA, in either palette", () => {
    const failures = sweep
      .map(({ hex, mode }) => ({
        hex,
        mode,
        ratio: worstPrimary(deriveAccent(hex, mode).primary, mode),
      }))
      .filter((r) => r.ratio < AA)
      .slice(0, 10)
      .map((r) => `${r.hex} ${r.mode}: ${r.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it("never produces a label that fails AA on its own fill", () => {
    const failures = sweep
      .map(({ hex, mode }) => {
        const tokens = deriveAccent(hex, mode);
        return {
          hex,
          mode,
          onPrimary: contrast(
            hexToRgb(tokens["on-primary"]),
            hexToRgb(tokens.primary),
          ),
        };
      })
      .filter((r) => r.onPrimary < AA)
      .slice(0, 10)
      .map((r) => `${r.hex} ${r.mode}: on-primary ${r.onPrimary.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it("returns the color that was asked for, not a different hue", () => {
    // The whole point of a picker. Lightness is negotiable because the
    // contract demands it; hue is not, and a naive clamp into the sRGB gamut
    // turns a bright red into an orange.
    const drifts = sweep
      .filter(({ hex }) => rgbToOklch(hexToRgb(hex)).c >= 0.08)
      .map(({ hex, mode }) => {
        const wanted = rgbToOklch(hexToRgb(hex)).h;
        const got = rgbToOklch(hexToRgb(deriveAccent(hex, mode).primary)).h;
        const delta = Math.abs(wanted - got);
        return { hex, mode, drift: Math.min(delta, 360 - delta) };
      })
      .filter((r) => r.drift > 5)
      .slice(0, 10);
    expect(drifts).toEqual([]);
  });

  it("gives a dark palette a lighter primary than a light one", () => {
    for (const hex of ["#e11d48", "#15803d", "#6d28d9"]) {
      const light = rgbToOklch(hexToRgb(deriveAccent(hex, "light").primary));
      const dark = rgbToOklch(hexToRgb(deriveAccent(hex, "dark").primary));
      expect(dark.l, hex).toBeGreaterThan(light.l);
    }
  });

  it("keeps a color that already clears the contract", () => {
    // The search stops at the first lightness that passes, so a color already
    // dark enough comes back untouched. Anything else would mean the picker
    // quietly ignores half its own range.
    const alreadyDark = "#00405a";
    expect(worstPrimary(alreadyDark, "light")).toBeGreaterThanOrEqual(AA);
    expect(deriveAccent(alreadyDark, "light").primary).toBe(alreadyDark);
  });

  it("moves the shipped primary, because its own contract is stricter", () => {
    // `deriveAccent` checks the 15% and 20% washes; the shipped light palette
    // does not clear them (see the last block). So a picked accent is held to a
    // higher bar than the default, and the default is deliberately never
    // derived — `applyTheme` leaves the hand-tuned values alone.
    expect(deriveAccent(DEFAULT_ACCENT, "light").primary).not.toBe(
      DEFAULT_ACCENT,
    );
  });

  it("survives black and white", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const hex of ["#000000", "#ffffff"]) {
        const tokens = deriveAccent(hex, mode);
        expect(worstPrimary(tokens.primary, mode)).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

// 4. The cases that are recorded rather than enforced, with their numbers

describe("the heavier primary washes", () => {
  /** The worst a text color reaches on `primary/<alpha>` in one palette. */
  const washWorst = (palette: Palette, text: string, alpha: number) =>
    Math.min(
      ...PILL_SURFACES.map((surface) =>
        contrast(
          hexToRgb(text),
          over(hexToRgb(palette.primary), alpha, hexToRgb(palette[surface])),
        ),
      ),
    );

  it("carries text on every one of them with the wash token", () => {
    // The guarantee this token exists for. `bg-primary/15` is the active
    // filter pill, the selected row in the list manager and the audit view's
    // range chips; `bg-primary/20` is two static uses and about twenty hover
    // states. All of them read.
    for (const mode of ["light", "dark"] as const) {
      const palette = PALETTES[mode];
      for (const alpha of ALL_PRIMARY_ALPHAS) {
        expect(
          washWorst(palette, palette["on-primary-wash"], alpha),
          `${mode} on-primary-wash over primary/${alpha * 100}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("still could not carry it with the primary, which is why the token exists", () => {
    // Pinned from both sides: if a light primary ever clears its own 15% wash,
    // `--color-on-primary-wash` is dead weight and this fails. The browser
    // audit cannot see either number, because an active filter pill and a
    // hover state are behind an interaction.
    const fifteen = washWorst(LIGHT, LIGHT.primary, 0.15);
    expect(fifteen).toBeGreaterThan(4.15);
    expect(fifteen).toBeLessThan(AA);

    const twenty = washWorst(LIGHT, LIGHT.primary, 0.2);
    expect(twenty).toBeGreaterThan(3.85);
    expect(twenty).toBeLessThan(AA);

    // Dark needs no separate token, and keeping the two equal is what makes
    // the dark pills look exactly as they shipped.
    expect(DARK["on-primary-wash"]).toBe(DARK.primary);
  });

  it("never writes the primary and a heavy wash into one class string", () => {
    // The rule the two tests above imply, checked against the source: a class
    // string that names both is a pill whose text is 4.21:1. The check reads
    // one string at a time, as the app sets a wash and its text together. A
    // wash on one element and a color on a child is left to
    // `scripts/contrast-audit.mjs`.
    const root = path.join(here, "../../../../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);

    // No leading boundary: a class string starts right after a quote or a
    // brace as often as after a space, and requiring one would let a line that
    // names both pass. The trailing guards keep `bg-primary/150` and
    // `text-primary-dim` out.
    const heavyWash = /bg-primary\/(?:15|20)(?!\d)/;
    const primaryText = /text-primary(?![-\w])/;
    const offenders: string[] = [];
    for (const file of files) {
      if (/index\.css$|lib\/theme\.ts$|lib\/color\.ts$/.test(file)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (heavyWash.test(line) && primaryText.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("carries AI chip text on every AI wash with its own wash token", () => {
    // The AI chips are `bg-ai/10 text-on-ai-wash`. The same guarantee the
    // primary wash token gives, for the second accent.
    for (const mode of ["light", "dark"] as const) {
      const palette = PALETTES[mode];
      for (const alpha of WASH_ALPHAS) {
        const worst = Math.min(
          ...PILL_SURFACES.map((surface) =>
            contrast(
              hexToRgb(palette["on-ai-wash"]),
              over(hexToRgb(palette.ai), alpha, hexToRgb(palette[surface])),
            ),
          ),
        );
        expect(
          worst,
          `${mode} on-ai-wash over ai/${alpha * 100}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("clears every one of them for a derived accent", () => {
    // A picked accent gets its own wash token from `deriveWashText`, so the
    // guarantee is the same one the shipped palettes give and not a weaker
    // version of it.
    for (const hex of ["#b45309", "#be123c", "#0f766e", "#6d28d9"]) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = deriveAccent(hex, mode);
        const palette = { ...PALETTES[mode], ...tokens };
        for (const alpha of ALL_PRIMARY_ALPHAS) {
          expect(
            washWorst(palette, tokens["on-primary-wash"], alpha),
            `${hex} ${mode} wash/${alpha * 100}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });

  it("returns the primary unchanged when it already reads on its own wash", () => {
    // Not an optimization, a guarantee: a dark accent that already works keeps
    // one color for both jobs, so a pill and the text beside it match.
    expect(deriveWashText(DARK.primary, DARK, "dark")).toBe(DARK.primary);
  });

  it("still treats the default accent as the hand-tuned palette", () => {
    // `applyTheme` skips the derivation entirely for this value, so the six
    // audited tokens are what the app paints.
    expect(DEFAULT_ACCENT).toBe(LIGHT.primary);
  });
});

// The highlighter and the AI hue

describe("the highlighter", () => {
  it.each(["light", "dark"] as const)(
    "carries the ink and the variant text in the %s palette",
    (mode) => {
      // `mark` paints `on-surface`, and a match inside muted text would
      // otherwise sit in `on-surface-variant`: both must read on it.
      const palette = PALETTES[mode];
      for (const text of ["on-surface", "on-surface-variant"] as const) {
        expect(
          contrast(hexToRgb(palette[text]), hexToRgb(palette.highlight)),
          `${mode} ${text} on highlight`,
        ).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it("is a warm wash, not a second blue", () => {
    for (const palette of [LIGHT, DARK]) {
      const { h, c } = rgbToOklch(hexToRgb(palette.highlight));
      expect(c).toBeGreaterThan(0.04);
      expect(h).toBeGreaterThan(60);
      expect(h).toBeLessThan(110);
    }
  });
});

describe("the AI color keeps its hue to itself", () => {
  const hueGap = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };

  it("keeps every contact vibe and every preset accent away from it", async () => {
    // A vibe or an accent replaces the primary on buttons and links. One on
    // the AI hue makes a Save button look like a model's chip, and the AI
    // chips beside it stop saying anything.
    const { VIBES, AI_HUE_CLEARANCE } =
      await import("../../../../src/lib/theme");
    const { ACCENT_PRESETS } =
      await import("../../../../src/components/ui/AccentPicker");
    // The color on screen is the derived primary, in each palette, and it
    // must clear that palette's own AI color: a preset that passes in light
    // can still come close to the dark AI color.
    const offenders: string[] = [];
    const check = (name: string, hex: string) => {
      if (rgbToOklch(hexToRgb(hex)).c < 0.05) return; // a gray has no hue
      for (const mode of ["light", "dark"] as const) {
        const painted = deriveAccent(hex, mode).primary;
        const { h, c } = rgbToOklch(hexToRgb(painted));
        if (c < 0.05) continue;
        const aiHue = rgbToOklch(hexToRgb(PALETTES[mode].ai)).h;
        const gap = hueGap(h, aiHue);
        if (gap < AI_HUE_CLEARANCE)
          offenders.push(`${name} ${hex} in ${mode}: ${gap.toFixed(0)}°`);
      }
    };
    for (const vibe of VIBES) check(`vibe ${vibe.id}`, vibe.base);
    for (const preset of ACCENT_PRESETS)
      check(`preset ${preset.label}`, preset.value);
    expect(offenders).toEqual([]);
  });

  it("offers no violet or indigo vibe", async () => {
    const { VIBES } = await import("../../../../src/lib/theme");
    expect(VIBES.map((v) => v.id)).not.toContain("violet");
    expect(VIBES.map((v) => v.id)).not.toContain("indigo");
  });
});
