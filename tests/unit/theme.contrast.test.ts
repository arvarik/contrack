// =============================================================================
// The contrast gate — both palettes, and every accent somebody can pick
// =============================================================================
// The browser-driven `scripts/contrast-audit.mjs` is the real measurement: it
// composites the live DOM and can see what a token actually lands on. It needs
// Chrome and a running server, so it cannot gate a pull request.
//
// This is the tripwire that can. It answers three questions the audit cannot
// answer cheaply:
//
//   1. Do `src/index.css` and `src/lib/theme.ts` still hold the same palettes?
//      The derivation reads the surfaces from the TypeScript copy, so a value
//      changed in one file and not the other makes every guarantee below a
//      statement about a palette nobody paints.
//   2. Does the DARK palette clear WCAG AA everywhere the LIGHT one does?
//      A new palette is the easiest place in an app to ship unreadable text.
//   3. Does EVERY accent a person can choose clear it? That is 6,000 colours
//      across the hue circle, in both palettes, and it is the only way to make
//      a colour picker safe: the alternative is a control that lets somebody
//      make their own app unreadable.
//
// One pairing is excluded and named rather than quietly dropped: `text-primary`
// on a `bg-primary/15` or `/20` wash, which the shipped light primary does not
// clear. `--color-on-primary-wash` is what carries text there instead, and the
// last block holds both halves: the wash token clears every alpha, and the
// primary still does not, which is why the token exists. A source scan keeps
// the two from being written together again.
// =============================================================================

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
} from "../../src/lib/theme";
import {
  contrast,
  hexToRgb,
  oklchToRgb,
  over,
  rgbToHex,
  rgbToOklch,
} from "../../src/lib/color";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../../src/index.css"), "utf8");

/**
 * Surfaces a piece of text can land on.
 *
 * `surface-variant` is deliberately absent: `bg-surface-variant` appears
 * nowhere in the app, and asserting against a background nothing uses inflates
 * the contract past what the shipped palette was measured for.
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
] as const;

/**
 * Alphas each token's own wash is enforced at.
 *
 * `primary` stops at 0.10, which is the heaviest wash `text-primary` is
 * allowed to sit on. Anything heavier carries `text-on-primary-wash`
 * instead, and that token is held to the full set in the last block.
 */
const ENFORCED_WASH_ALPHAS: Partial<
  Record<(typeof TEXT_TOKENS)[number], number[]>
> = {
  primary: [0.1],
  error: [0.1],
  warning: [0.1],
};

/** Every alpha `bg-primary/*` is written at in the app. */
const ALL_PRIMARY_ALPHAS = [...WASH_ALPHAS];

/** Text painted directly on a filled token. */
const FILLS: [keyof Palette, keyof Palette][] = [
  ["on-primary", "primary"],
  ["on-error", "error"],
  ["on-primary-container", "primary-container"],
  ["on-secondary-container", "secondary-container"],
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

// ---------------------------------------------------------------------------
// 1. The two files agree
// ---------------------------------------------------------------------------

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

  it("defines a colour scheme for both palettes", () => {
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

  it("gives the frosted panel and the swipe overlays a dark value", () => {
    // Three literals that no token describes. Each appears twice: once for a
    // dark machine, once for a chosen dark theme.
    for (const selector of [
      ".glass-panel",
      ".swipe-approve-overlay",
      ".swipe-reject-overlay",
    ]) {
      const occurrences = css.split(selector).length - 1;
      expect(occurrences, selector).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Both palettes clear AA
// ---------------------------------------------------------------------------

describe.each(["light", "dark"] as const)("the %s palette", (mode) => {
  const cases = casesFor(PALETTES[mode]);

  it("checks more than sixty colour pairs", () => {
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

// ---------------------------------------------------------------------------
// 3. Every accent somebody can pick
// ---------------------------------------------------------------------------

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

  it("sweeps six thousand colours", () => {
    expect(sweep).toHaveLength(6000);
  });

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
          onContainer: contrast(
            hexToRgb(tokens["on-primary-container"]),
            hexToRgb(tokens["primary-container"]),
          ),
        };
      })
      .filter((r) => r.onPrimary < AA || r.onContainer < AA)
      .slice(0, 10)
      .map(
        (r) =>
          `${r.hex} ${r.mode}: on-primary ${r.onPrimary.toFixed(2)}, on-container ${r.onContainer.toFixed(2)}`,
      );
    expect(failures).toEqual([]);
  });

  it("returns the colour that was asked for, not a different hue", () => {
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

  it("keeps a colour that already clears the contract", () => {
    // The search stops at the first lightness that passes, so a colour already
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

// ---------------------------------------------------------------------------
// 4. The cases that are recorded rather than enforced, with their numbers
// ---------------------------------------------------------------------------

describe("the heavier primary washes", () => {
  /** The worst a text colour reaches on `primary/<alpha>` in one palette. */
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
    // Pinned from both sides on purpose. If a future light primary clears its
    // own 15% wash then `--color-on-primary-wash` is dead weight and this test
    // says so by failing, rather than leaving a token nobody can justify.
    //
    // The browser-driven audit cannot see either number: an active filter pill
    // and a hover state are both behind an interaction, and it reads what is on
    // screen at load. That is why this file exists.
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
    // The rule the two tests above imply, checked against the source. A class
    // string that names both is a pill whose text is 4.21:1, and neither the
    // palette tests nor the browser audit can see it.
    //
    // One string at a time, which is what the app writes: a wash and its text
    // are set together. A wash on one element and a colour on a child three
    // lines down is outside this check, and `scripts/contrast-audit.mjs` with
    // a populated instance is what would find that.
    const root = path.join(here, "../../src");
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
    // brace as often as after a space, and requiring one made this scan pass
    // on a line that named both. The trailing guards are what matter, so
    // `bg-primary/150` and `text-primary-dim` do not count.
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
    // Not an optimisation, a guarantee: a dark accent that already works keeps
    // one colour for both jobs, so a pill and the text beside it match.
    expect(deriveWashText(DARK.primary, DARK, "dark")).toBe(DARK.primary);
  });

  it("still treats the default accent as the hand-tuned palette", () => {
    // `applyTheme` skips the derivation entirely for this value, so the five
    // audited tokens are what the app paints.
    expect(DEFAULT_ACCENT).toBe(LIGHT.primary);
  });
});
