/**
 * theme.ts — the two palettes, the accent derivation, and how they are applied.
 *
 * ── Why the palettes are here as well as in index.css ──────────────────────
 * `src/index.css` is what the browser paints from. This file holds the same
 * values because the accent derivation has to know what is behind the text it
 * is choosing a colour for, and because the contrast gate has to check them
 * without a browser. `tests/unit/theme.contrast.test.ts` asserts the two agree
 * token for token, in both palettes, so they cannot drift.
 *
 * ── The contrast contract ──────────────────────────────────────────────────
 * Every colour used as text or as an icon clears WCAG AA (4.5:1) against every
 * surface it actually lands on, in BOTH palettes — including the pale washes a
 * badge is built from, where a colour sits on fifteen percent of itself. That
 * was already the rule for the light palette. The dark palette is held to it
 * by the same test, and so is every accent a person can pick: the derivation
 * below searches for a lightness that satisfies it rather than assuming one.
 *
 * @module lib/theme
 */

import {
  contrast,
  hexToRgb,
  oklchToRgb,
  over,
  rgbToHex,
  rgbToOklch,
  scaleChroma,
  withLightness,
  type Oklch,
} from "./color";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

/** The accent the app ships with. Its palette is hand-tuned, not derived. */
export const DEFAULT_ACCENT = "#006a91";

/** WCAG AA for body text. Large text is allowed 3.0; nothing here relies on that. */
export const AA = 4.5;

/**
 * The alpha of the pale wash a pill or badge is built from.
 *
 * `bg-primary/15` over a sectional background, with `text-primary` on top, is
 * the worst real case in the app and the one that set the light primary.
 */
export const WASH_ALPHA = 0.15;

/**
 * Every alpha `bg-primary/<n>` is used at, heaviest last.
 *
 * `WASH_ALPHA` above is the one the primary search uses, because it is the
 * common case and the primary has other duties. This list is what the text
 * that sits ON a wash is held to, and there the heaviest one binds: 20% is
 * two static pills and about twenty hover states, and a hover state that
 * drops below AA is still a hover state somebody has to read.
 */
export const WASH_ALPHAS = [0.1, WASH_ALPHA, 0.2] as const;

/**
 * The surfaces a pale pill actually sits on.
 *
 * Narrower than {@link SURFACE_TOKENS} on purpose. `surface-variant` is used
 * zero times as a background in this app, and including it made the contract
 * stricter than the product without making any screen more readable. These
 * four are the page, a card, and the two sectional greys a filter bar or a
 * list row is drawn on.
 */
export const PILL_SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
] as const;

// ---------------------------------------------------------------------------
// The palettes
// ---------------------------------------------------------------------------

/** Every token both palettes define. The keys are the `--color-*` names. */
export interface Palette {
  primary: string;
  "primary-dim": string;
  "primary-container": string;
  "on-primary": string;
  "on-primary-container": string;
  /**
   * Text and icons drawn ON a `bg-primary/<n>` wash.
   *
   * Usually the primary itself, and in the light palette it cannot be. The
   * shipped light primary measures 4.21:1 on its own 15% wash and 3.92:1 on
   * the 20% one, against a 4.5 requirement, so an active filter pill and
   * every `hover:bg-primary/20` fell short. Recorded as A-03 for one release
   * before this token existed.
   *
   * A separate token rather than a darker brand: `--color-primary` is 299
   * call sites, every filled button and the branding gradient, and darkening
   * it to satisfy a pill is a product decision. This changes only the text
   * that sits on a wash, which is the only place the number was wrong.
   */
  "on-primary-wash": string;
  secondary: string;
  "secondary-container": string;
  "on-secondary-container": string;
  success: string;
  warning: string;
  info: string;
  error: string;
  "on-error": string;
  surface: string;
  "on-surface": string;
  "surface-variant": string;
  "on-surface-variant": string;
  "surface-container-lowest": string;
  "surface-container-low": string;
  "surface-container": string;
  "surface-container-high": string;
  "surface-container-highest": string;
  "outline-variant": string;
}

export const LIGHT: Palette = {
  primary: "#006a91",
  "primary-dim": "#00628a",
  "primary-container": "#47befd",
  "on-primary": "#ffffff",
  "on-primary-container": "#001e2f",
  // Four lightness steps below the primary, which is what `deriveWashText`
  // returns for it. 4.66:1 at worst, against 4.21:1 for the primary itself.
  "on-primary-wash": "#005e81",
  secondary: "#4d626c",
  "secondary-container": "#cfe6f2",
  "on-secondary-container": "#40555f",
  success: "#046b4e",
  warning: "#9a4c08",
  info: "#036796",
  error: "#bf1b1b",
  "on-error": "#ffffff",
  surface: "#f5f6f9",
  "on-surface": "#2a3437",
  "surface-variant": "#d9e4e8",
  "on-surface-variant": "#566164",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#eff1f4",
  "surface-container": "#e8eff1",
  "surface-container-high": "#e0e3e6",
  "surface-container-highest": "#d9e4e8",
  "outline-variant": "#c9d3d9",
};

/**
 * The dark palette.
 *
 * Not an inversion. Inverting the light stack puts the card below the page,
 * and every shadow in the app says the card is above it — so the order by
 * lightness is reversed on purpose: the page is the darkest thing on screen
 * and a card is lighter than the page it sits on, which is what reads as
 * raised when there is no white to cast a shadow onto.
 *
 * Every text colour here was chosen by the contrast gate rather than by eye.
 * The status hues in particular: an accessible dark amber is pale, the way an
 * accessible light amber is brown.
 */
export const DARK: Palette = {
  primary: "#6ec6ee",
  "primary-dim": "#8ed4f4",
  "primary-container": "#00506f",
  "on-primary": "#00242f",
  "on-primary-container": "#c2e7fb",
  // The primary unchanged. It already reads at 5.38:1 on its own heaviest
  // wash, so `deriveWashText` returns it at step zero and the dark pills look
  // exactly as they shipped.
  "on-primary-wash": "#6ec6ee",
  secondary: "#b0c2ca",
  "secondary-container": "#2d4049",
  "on-secondary-container": "#cfe6f2",
  success: "#5ad3a3",
  warning: "#f1b569",
  info: "#72c5ec",
  error: "#ff9d95",
  "on-error": "#4c0c0c",
  surface: "#0f1315",
  "on-surface": "#dfe4e6",
  "surface-variant": "#394145",
  "on-surface-variant": "#b2bbbf",
  "surface-container-lowest": "#191e21",
  "surface-container-low": "#141819",
  "surface-container": "#1d2326",
  "surface-container-high": "#242a2d",
  "surface-container-highest": "#2b3235",
  "outline-variant": "#394044",
};

export const PALETTES: Record<ResolvedMode, Palette> = {
  light: LIGHT,
  dark: DARK,
};

/** Every surface a piece of text can be painted on, in one palette. */
export const SURFACE_TOKENS = [
  "surface",
  "surface-variant",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
] as const;

// ---------------------------------------------------------------------------
// Accent derivation
// ---------------------------------------------------------------------------

/** The tokens an accent replaces. */
export const ACCENT_TOKENS = [
  "primary",
  "primary-dim",
  "primary-container",
  "on-primary",
  "on-primary-container",
  "on-primary-wash",
] as const;

export type AccentTokens = Record<(typeof ACCENT_TOKENS)[number], string>;

/**
 * The worst background `text-primary` can land on for a given primary.
 *
 * Not a constant, because the worst case depends on the primary itself: the
 * wash is fifteen percent of the very colour being checked. Returns every
 * candidate background so the search below can require all of them at once.
 */
function primaryBackgrounds(primaryHex: string, palette: Palette) {
  const primary = hexToRgb(primaryHex);
  const surfaces = SURFACE_TOKENS.map((token) => hexToRgb(palette[token]));
  return [
    ...surfaces,
    ...surfaces.map((surface) => over(primary, WASH_ALPHA, surface)),
  ];
}

/**
 * A colour that reads on every wash made from `primaryHex`.
 *
 * The wash is `primaryHex` at 10, 15 or 20 percent over one of the four
 * surfaces a pill sits on, so the twelve backgrounds are all built from the
 * primary being passed in. The search walks lightness away from the surfaces,
 * one step at a time, and stops at the first value that clears AA on all
 * twelve.
 *
 * Step zero is tried first and returned unchanged when it passes, which is
 * what happens in the dark palette: the dark primary already reads on its own
 * heaviest wash, so dark pills keep exactly the colour they had.
 *
 * @param primaryHex - The primary the wash is made from.
 * @param palette - The palette whose surfaces sit behind the wash.
 * @param mode - Light walks darker, dark walks lighter.
 * @returns A hex colour that clears AA on every wash, or the darkest or
 *   lightest the hue reaches if none does.
 */
export function deriveWashText(
  primaryHex: string,
  palette: Palette,
  mode: ResolvedMode,
): string {
  const primary = hexToRgb(primaryHex);
  const backgrounds = PILL_SURFACES.flatMap((token) =>
    WASH_ALPHAS.map((alpha) => over(primary, alpha, hexToRgb(palette[token]))),
  );
  const base = rgbToOklch(primary);
  const step = mode === "light" ? -0.01 : 0.01;

  let candidate = primaryHex;
  for (let i = 0; i < 200; i++) {
    const lightness = Math.max(0, Math.min(1, base.l + step * i));
    candidate = rgbToHex(oklchToRgb(withLightness(base, lightness)));
    const worst = backgrounds.reduce(
      (low, background) =>
        Math.min(low, contrast(hexToRgb(candidate), background)),
      Infinity,
    );
    if (worst >= AA) return candidate;
    if (lightness === 0 || lightness === 1) break;
  }
  return candidate;
}

/** The lowest contrast `text-primary` reaches anywhere in the app. */
function worstPrimaryContrast(primaryHex: string, palette: Palette): number {
  const primary = hexToRgb(primaryHex);
  return primaryBackgrounds(primaryHex, palette).reduce(
    (worst, background) => Math.min(worst, contrast(primary, background)),
    Infinity,
  );
}

/**
 * Walk lightness until the colour is readable, and stop at the first one.
 *
 * `step` is negative in light mode (darken until it reads on white) and
 * positive in dark mode (lighten until it reads on near-black). Stopping at
 * the first pass rather than at some fixed target keeps as much of the chosen
 * colour as the contract allows: somebody who picks a pale pink gets the
 * darkest pale pink that is still readable, not navy.
 */
function searchLightness(
  base: Oklch,
  palette: Palette,
  step: number,
): { hex: string; lightness: number } {
  let lightness = base.l;
  for (let i = 0; i <= 200; i++) {
    const hex = rgbToHex(oklchToRgb(withLightness(base, lightness)));
    if (worstPrimaryContrast(hex, palette) >= AA) return { hex, lightness };
    lightness += step;
    if (lightness <= 0 || lightness >= 1) break;
  }
  // Out of room: black in light mode, white in dark. Both are readable.
  const fallback =
    step < 0 ? { l: 0, c: 0, h: base.h } : { l: 1, c: 0, h: base.h };
  return { hex: rgbToHex(oklchToRgb(fallback)), lightness: fallback.l };
}

/** The better of black and white on a given fill, which is always one of them. */
function bestOn(fillHex: string): string {
  const fill = hexToRgb(fillHex);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  return contrast(white, fill) >= contrast(black, fill) ? "#ffffff" : "#000000";
}

/**
 * Turn one chosen colour into the accent tokens the app paints with.
 *
 * The input is a wish, not an instruction. Hue is kept exactly, chroma is kept
 * as far as the sRGB gamut allows, and lightness is whatever the contrast
 * contract permits — because a primary that fails AA is not a preference, it
 * is an unusable app.
 */
export function deriveAccent(hex: string, mode: ResolvedMode): AccentTokens {
  const palette = PALETTES[mode];
  const base = rgbToOklch(hexToRgb(hex));
  const step = mode === "light" ? -0.01 : 0.01;

  const { hex: primary, lightness } = searchLightness(base, palette, step);

  // `primary-dim` is the hover and the dark end of the branding gradient. One
  // notch further along the same direction, and still readable because it is
  // further from the surfaces than the primary that just passed.
  const dim = rgbToHex(
    oklchToRgb(
      withLightness(base, Math.max(0, Math.min(1, lightness + step * 4))),
    ),
  );

  // `primary-container` is a fill and never carries text of its own. Light
  // mode wants it pale, dark mode wants it deep; both keep the hue.
  const container = rgbToHex(
    oklchToRgb(
      scaleChroma(
        withLightness(base, mode === "light" ? 0.78 : 0.36),
        1.0,
        0.18,
      ),
    ),
  );

  // `on-primary-container` does carry text, so it is pushed until it reads on
  // the container it sits on.
  const onContainerBase = withLightness(base, mode === "light" ? 0.2 : 0.92);
  let onContainer = rgbToHex(oklchToRgb(onContainerBase));
  for (let i = 0; i < 100; i++) {
    if (contrast(hexToRgb(onContainer), hexToRgb(container)) >= AA) break;
    const next = withLightness(
      onContainerBase,
      onContainerBase.l + (mode === "light" ? -0.01 : 0.01) * (i + 1),
    );
    onContainer = rgbToHex(oklchToRgb(next));
  }

  return {
    primary,
    "primary-dim": dim,
    "primary-container": container,
    "on-primary": bestOn(primary),
    "on-primary-container": onContainer,
    // From the searched primary, not from `hex`. The wash on screen is made
    // from the primary that ends up in the stylesheet, so that is the colour
    // the text has to read against.
    "on-primary-wash": deriveWashText(primary, palette, mode),
  };
}

// ---------------------------------------------------------------------------
// Vibes — the per-contact accent
// ---------------------------------------------------------------------------

/**
 * The eight colours a contact can be given.
 *
 * One base value each, and the tokens are derived from it exactly the way a
 * chosen accent is. They used to be eight hand-written triples, tuned for the
 * light palette and used unchanged in every palette — which in dark mode put
 * `#00648A` on a near-black page at 2.84:1, a number the browser audit found
 * on the contact detail route the first time it was run against both.
 *
 * Deriving them instead means the vibe answers the same contrast contract the
 * accent picker does, in both palettes, and the sweep in
 * `tests/unit/theme.contrast.test.ts` already covers the arithmetic.
 */
export const VIBES: readonly { id: string; label: string; base: string }[] = [
  { id: "brand", label: "Blue", base: DEFAULT_ACCENT },
  { id: "emerald", label: "Emerald", base: "#059669" },
  { id: "amber", label: "Amber", base: "#d97706" },
  { id: "rose", label: "Rose", base: "#e11d48" },
  { id: "indigo", label: "Indigo", base: "#4f46e5" },
  { id: "pink", label: "Pink", base: "#be185d" },
  { id: "violet", label: "Violet", base: "#6d28d9" },
  { id: "teal", label: "Teal", base: "#0f766e" },
];

/** The primary tokens for one vibe, in one palette. Falls back to the first. */
export function vibeTokens(
  id: string | null | undefined,
  mode: ResolvedMode,
): AccentTokens {
  const vibe = VIBES.find((v) => v.id === id) ?? VIBES[0];
  return deriveAccent(vibe.base, mode);
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

/** Where the browser keeps the last painted theme, so the next load has no flash. */
export const THEME_CACHE_KEY = "contrack.theme";

/**
 * What the boot script in `public/theme-boot.js` reads.
 *
 * The setting is cached as well as the resolved mode, and that is the point:
 * "system" must not be pinned. A browser that cached `dark` because the
 * machine was dark last night would otherwise paint dark this morning on a
 * light machine, and hold it until the preferences request came back.
 *
 * This cache is per browser, not per account, because the boot script runs
 * before anyone has signed in. Nothing in it is private — a palette choice and
 * a handful of colours — and the account's real preference replaces it one request
 * later.
 */
export interface ThemeCache {
  /** What was chosen: light, dark, or follow the machine. */
  theme: ThemeMode;
  /** The accent that was chosen, so the app can start from it too. */
  accent: string;
  /** What the theme resolved to when it was last painted. */
  mode: ResolvedMode;
  /** `--color-*` name to value. Empty when the default accent is in use. */
  vars: Record<string, string>;
}

/**
 * The last theme this browser painted, for the app to start from.
 *
 * The boot script has already applied it by the time React runs, so starting
 * from the defaults instead would mean one of two things: the app repaints to
 * the default and then back when the account's answer arrives, or — when the
 * server cannot be reached at all — it repaints to the default and stays
 * there, which turns a network failure into somebody's theme being reset.
 *
 * Anything unreadable answers null and the defaults apply, which is what a
 * browser that has never painted this app gets anyway.
 */
export function readThemeCache(): { theme: ThemeMode; accent: string } | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<ThemeCache>;
    const theme = cached.theme;
    if (theme !== "light" && theme !== "dark" && theme !== "system")
      return null;
    const accent =
      typeof cached.accent === "string" && /^#[0-9a-f]{6}$/i.test(cached.accent)
        ? cached.accent.toLowerCase()
        : DEFAULT_ACCENT;
    return { theme, accent };
  } catch {
    return null;
  }
}

/** `system` asks the operating system; the other two answer for themselves. */
export function resolveMode(theme: ThemeMode): ResolvedMode {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Paint the theme, and remember it for the next page load.
 *
 * The accent is applied as inline custom properties on `<html>`, which beat
 * the stylesheet's `:root` values. The default accent applies none of them:
 * the shipped palette is hand-tuned and measured, and re-deriving it would
 * replace audited values with computed ones for no gain.
 */
export function applyTheme(
  theme: ThemeMode,
  accent: string,
  root: HTMLElement = document.documentElement,
): ResolvedMode {
  const mode = resolveMode(theme);
  // "system" removes the attribute rather than writing the resolved value:
  // the stylesheet's `prefers-color-scheme` block already answers, and an
  // attribute would freeze the answer until the next render.
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  const vars: Record<string, string> = {};
  if (accent.toLowerCase() !== DEFAULT_ACCENT) {
    for (const [token, value] of Object.entries(deriveAccent(accent, mode))) {
      vars[`--color-${token}`] = value;
    }
  }

  // Every accent token is written or removed on every call, never only
  // written. Going back to the default accent has to take the previous one
  // off, or the inline properties outlive the choice that made them.
  for (const token of ACCENT_TOKENS) {
    const name = `--color-${token}`;
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }

  try {
    const cache: ThemeCache = {
      theme,
      accent: accent.toLowerCase(),
      mode,
      vars,
    };
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private browsing, or storage that is full. The theme still applied; the
    // next load simply starts from the stylesheet and corrects itself.
  }

  return mode;
}
