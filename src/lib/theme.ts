/**
 * The two palettes, the accent derivation, and how they are applied.
 *
 * The palettes repeat index.css because the accent derivation must know what
 * sits behind the text, and the contrast gate checks them without a browser.
 * `themeContrast.test.ts` holds the two files equal, token for token.
 *
 * The contract: every color used as text or as an icon clears WCAG AA
 * (4.5:1) on every surface it lands on, in both palettes, the pale washes
 * included. Every accent a person can pick is held to it too: the derivation
 * searches for a lightness that passes.
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
 * The alpha of the pale wash a pill or badge is built from. `text-primary`
 * on `bg-primary/15` is the worst real case, and it set the light primary.
 */
export const WASH_ALPHA = 0.15;

/**
 * Every alpha `bg-primary/<n>` is used at, heaviest last. The primary search
 * uses `WASH_ALPHA` alone. Text that sits on a wash is held to all of them,
 * because a hover state below AA is still text somebody has to read.
 */
export const WASH_ALPHAS = [0.1, WASH_ALPHA, 0.2] as const;

/**
 * The surfaces a pale pill sits on: the page, a card, and the two sectional
 * grays. Narrower than {@link SURFACE_TOKENS} on purpose: no background uses
 * `surface-variant`.
 */
export const PILL_SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
] as const;

// The palettes

/** Every token both palettes define. The keys are the `--color-*` names. */
export interface Palette {
  primary: string;
  "primary-dim": string;
  "primary-container": string;
  "on-primary": string;
  /**
   * Text and icons drawn on a `bg-primary/<n>` wash. Often the primary
   * itself, but the light primary reads at 4.21:1 on its 15% wash and 3.92:1
   * on the 20% one. A separate token, so the brand primary on every button
   * stays as it is.
   */
  "on-primary-wash": string;
  /**
   * AI-derived data only: the chips an enrichment run added and the note
   * glyph. Not replaced by an accent, so a contact's color never makes its
   * own data read as a model's.
   */
  ai: string;
  /** Text and icons on a 10, 15 or 20 percent wash of `ai`. */
  "on-ai-wash": string;
  /**
   * The highlighter behind the words a search matched (`mark`). A
   * background only: the text on it is always `on-surface`.
   */
  highlight: string;
  secondary: string;
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
  // Four lightness steps below the primary, which is what `deriveWashText`
  // returns for it. 4.66:1 at worst, against 4.21:1 for the primary itself.
  "on-primary-wash": "#005e81",
  // 4.92:1 at worst on a surface, 4.75:1 on its own 10 percent wash. The wash
  // text is what `deriveWashText` returns for it.
  ai: "#6f3fd0",
  "on-ai-wash": "#6734c6",
  highlight: "#fce7a6",
  secondary: "#4d626c",
  success: "#046b4e",
  warning: "#9a4c08",
  info: "#036796",
  error: "#bf1b1b",
  "on-error": "#ffffff",
  // Warm paper: hue 85 in OKLCH at a chroma of 0.005 to 0.010, with the
  // lightness of each step kept where the cool grays were measured.
  surface: "#f8f6f2",
  "on-surface": "#2a3437",
  "surface-variant": "#e5e2db",
  "on-surface-variant": "#566164",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#f2f1ed",
  "surface-container": "#f1eeea",
  "surface-container-high": "#e7e5e1",
  "surface-container-highest": "#e5e2db",
  "outline-variant": "#d4d1cb",
};

/**
 * The dark palette. Not an inversion: the page is the darkest thing on
 * screen and a card is lighter than the page, which reads as raised. Every
 * text color here was chosen by the contrast gate, not by eye.
 */
export const DARK: Palette = {
  primary: "#6ec6ee",
  "primary-dim": "#8ed4f4",
  "primary-container": "#00506f",
  "on-primary": "#00242f",
  // The primary itself: 5.38:1 on its own heaviest wash, so `deriveWashText`
  // returns it at step zero.
  "on-primary-wash": "#6ec6ee",
  // Reads at 6.16:1 on its own heaviest wash, so the wash text is the same.
  ai: "#bfa3f9",
  "on-ai-wash": "#bfa3f9",
  highlight: "#5a4116",
  secondary: "#b0c2ca",
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
const SURFACE_TOKENS = [
  "surface",
  "surface-variant",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
] as const;

// Accent derivation

/** The tokens an accent replaces. */
export const ACCENT_TOKENS = [
  "primary",
  "primary-dim",
  "primary-container",
  "on-primary",
  "on-primary-wash",
] as const;

export type AccentTokens = Record<(typeof ACCENT_TOKENS)[number], string>;

/**
 * Every background `text-primary` can land on for a given primary. Not a
 * constant, because the wash is made from the primary being checked.
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
 * A color that reads on every wash made from `primaryHex`: the primary at 10,
 * 15 or 20 percent over each of the four pill surfaces. The search walks
 * lightness away from the surfaces, darker in light mode and lighter in
 * dark, and stops at the first value that clears AA on all twelve. Step zero
 * comes first, so a primary that already reads is returned as it is. If no
 * step passes, it returns the darkest or lightest the hue reaches.
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
 * Walk lightness until the color is readable: darker in light mode (a
 * negative `step`), lighter in dark. Stopping at the first pass keeps as much
 * of the chosen color as the contract allows: a pale pink becomes the
 * palest readable pink, not navy.
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
 * Turn one chosen color into the accent tokens the app paints with. Hue is
 * kept exactly, chroma as far as the sRGB gamut allows, and lightness is
 * whatever the contrast contract permits.
 */
export function deriveAccent(hex: string, mode: ResolvedMode): AccentTokens {
  const palette = PALETTES[mode];
  const base = rgbToOklch(hexToRgb(hex));
  const step = mode === "light" ? -0.01 : 0.01;

  const { hex: primary, lightness } = searchLightness(base, palette, step);

  // `primary-dim` is the hover and the gradient's dark end: four steps further
  // from the surfaces than the primary, so it still reads.
  const dim = rgbToHex(
    oklchToRgb(
      withLightness(base, Math.max(0, Math.min(1, lightness + step * 4))),
    ),
  );

  // `primary-container` is a fill and carries no text: pale in light mode,
  // deep in dark, in the same hue.
  const container = rgbToHex(
    oklchToRgb(
      scaleChroma(
        withLightness(base, mode === "light" ? 0.78 : 0.36),
        1.0,
        0.18,
      ),
    ),
  );

  return {
    primary,
    "primary-dim": dim,
    "primary-container": container,
    "on-primary": bestOn(primary),
    // From the searched primary, not from `hex`: the wash on screen is made
    // from the primary in the stylesheet.
    "on-primary-wash": deriveWashText(primary, palette, mode),
  };
}

// Vibes: the per-contact accent

/**
 * The six colors a contact can be given. Each is one base value, derived the
 * way a chosen accent is, so a vibe meets the same contrast contract in both
 * palettes. A vibe replaces the primary on its contact's page, so every vibe
 * keeps {@link AI_HUE_CLEARANCE} degrees from the AI hue. A stored id that
 * is not here, such as "violet" or "indigo", reads as the first vibe.
 */
export const VIBES: readonly { id: string; label: string; base: string }[] = [
  { id: "brand", label: "Blue", base: DEFAULT_ACCENT },
  { id: "emerald", label: "Emerald", base: "#059669" },
  { id: "amber", label: "Amber", base: "#d97706" },
  { id: "rose", label: "Rose", base: "#e11d48" },
  { id: "pink", label: "Pink", base: "#be185d" },
  { id: "teal", label: "Teal", base: "#0f766e" },
];

/**
 * How far, in degrees of OKLCH hue, a preset accent or a vibe keeps from the
 * AI color. Thirty is where a violet and a magenta stop reading as one
 * color at a glance on both palettes.
 */
export const AI_HUE_CLEARANCE = 30;

/** The primary tokens for one vibe, in one palette. Falls back to the first. */
export function vibeTokens(
  id: string | null | undefined,
  mode: ResolvedMode,
): AccentTokens {
  const vibe = VIBES.find((v) => v.id === id) ?? VIBES[0];
  return deriveAccent(vibe.base, mode);
}

// Applying it

/** Where the browser keeps the last painted theme, so the next load has no flash. */
export const THEME_CACHE_KEY = "contrack.theme";

/**
 * What the boot script in `public/theme-boot.js` reads. The setting is cached
 * as well as the resolved mode, so "system" is never pinned to last night's
 * dark. The cache is per browser, because the boot script runs before
 * sign-in. Nothing in it is private, and the account's preference replaces
 * it one request later.
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
 * The last theme this browser painted, for the app to start from. The boot
 * script has already applied it, so starting from the defaults would flash
 * the default, or keep it when the server is down. Anything unreadable
 * answers null, and the defaults apply.
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
 * The browser bar's color for each palette: the page background, as the two
 * `theme-color` metas in index.html give it.
 */
const BAR_COLORS = { light: "#f8f6f2", dark: "#0f1315" } as const;

/**
 * Point both `theme-color` metas at the chosen palette. Each meta answers one
 * system scheme, so without this the Android bar follows the system, not the
 * page. "system" gives each meta its own color back.
 */
function syncThemeColor(theme: ThemeMode): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const own = meta.media.includes("dark") ? "dark" : "light";
    meta.content = BAR_COLORS[theme === "system" ? own : theme];
  }
}

/**
 * Paint the theme, and remember it for the next page load. The accent is
 * inline custom properties on `<html>`, which beat the stylesheet's `:root`.
 * The default accent sets none: its palette is hand-tuned and measured.
 */
export function applyTheme(theme: ThemeMode, accent: string): ResolvedMode {
  const root = document.documentElement;
  const mode = resolveMode(theme);
  // "system" removes the attribute: the stylesheet's `prefers-color-scheme`
  // block answers, and an attribute would freeze the answer.
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  syncThemeColor(theme);

  const vars: Record<string, string> = {};
  if (accent.toLowerCase() !== DEFAULT_ACCENT) {
    for (const [token, value] of Object.entries(deriveAccent(accent, mode))) {
      vars[`--color-${token}`] = value;
    }
  }

  // Write or remove every token, so going back to the default accent takes
  // the previous one off.
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
    // Private browsing or full storage. The theme still applied, and the next
    // load starts from the stylesheet.
  }

  return mode;
}
