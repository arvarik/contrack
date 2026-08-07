// =============================================================================
// Avatar Service — deterministic avatar SVGs, generated in-process
// =============================================================================
// Contrack used to point every contact's avatar at `api.dicebear.com`, with the
// contact's name in the query string. Rendering the contact list therefore sent
// the name of every person the user knows to a third party, on every page load,
// from an app whose entire pitch is local-first and privacy-focused. Those
// people never agreed to that. It was also a hard runtime dependency: offline,
// every contact without an uploaded photo was a broken image.
//
// The DiceBear npm packages are not API clients — they carry the artwork and
// compose the SVG by computation. So this is not a cache in front of a network
// call; the network call no longer exists. Generation is deterministic, so the
// same name always produces the same face, and it costs roughly a millisecond.
//
// Nothing is written to disk. The output is a pure function of (style, seed),
// so HTTP caching on the route is the whole cache — see routes/avatar.ts.
// =============================================================================

// DiceBear v9 style packages export `{ create, meta, schema }` rather than a
// named style object, so the namespace *is* the style.
import { createAvatar } from "@dicebear/core";
import * as avataaars from "@dicebear/avataaars";
import * as lorelei from "@dicebear/lorelei";
import * as bottts from "@dicebear/bottts";
import * as initials from "@dicebear/initials";
import { classifyName } from "../utils/smartAvatar.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

/** Styles the app offers. `initials` doubles as the last-resort fallback. */
export const AVATAR_STYLES = [
  "avataaars",
  "lorelei",
  "bottts",
  "initials",
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export function isAvatarStyle(value: string): value is AvatarStyle {
  return (AVATAR_STYLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Expression presets
// ---------------------------------------------------------------------------

/**
 * Friendly-face constraints for avataaars.
 *
 * The old URLs constrained only `mouth`, which left `eyebrows` and `eyes` free
 * — so a contact could land on `angry` brows over a `serious` mouth, or `cry`
 * eyes, and scowl out of the address book at you. A CRM's avatars should be
 * neutral-to-warm; nobody wants a directory of people who look annoyed.
 *
 * Excluded on purpose:
 *   eyebrows — angry, angryNatural, frownNatural, sadConcerned,
 *              sadConcernedNatural, unibrowNatural
 *   eyes     — cry, xDizzy, eyeRoll, squint, closed (asleep), hearts (odd
 *              in a professional context), vomit-adjacent expressions
 */
export const FRIENDLY_EYEBROWS = [
  "default",
  "defaultNatural",
  "flatNatural",
  "raisedExcited",
  "raisedExcitedNatural",
  "upDown",
  "upDownNatural",
] as const;

export const FRIENDLY_EYES = [
  "default",
  "happy",
  "side",
  "surprised",
  "wink",
] as const;

/** Unchanged from the previous URLs — already a friendly set. */
export const FRIENDLY_MOUTH = ["default", "smile", "serious"] as const;

/**
 * Expressions that must never reach a contact's face.
 *
 * Asserted in the tests rather than merely commented, because the failure mode
 * is silent: DiceBear ignores an option value it does not recognise, so a
 * single typo in the allow-lists above would quietly restore the *entire*
 * pool — angry brows included — with nothing to notice at runtime.
 */
export const BANNED_EXPRESSIONS = {
  eyebrows: [
    "angry",
    "angryNatural",
    "frownNatural",
    "sadConcerned",
    "sadConcernedNatural",
    "unibrowNatural",
  ],
  eyes: ["cry", "xDizzy", "eyeRoll", "squint", "closed", "hearts"],
  mouth: ["concerned", "disbelief", "grimace", "sad", "screamOpen", "vomit"],
} as const;

/** Emoji-yellow, matching what the app has always used. */
const SKIN_COLOR = ["f8d25c"] as const;

/**
 * Gender-tuned asset pools, carried over from the URL builder this replaces.
 *
 * The point is variety, not assumption: constraining the pool means two people
 * of the same classification still differ (the seed picks within the pool),
 * while an unclassified name gets the full range rather than a guess.
 */
const GENDER_PRESETS = {
  male: {
    top: [
      "shortFlat",
      "shortRound",
      "shortWaved",
      "shortCurly",
      "theCaesar",
      "theCaesarAndSidePart",
      "sides",
      "shavedSides",
      "dreads01",
      "frizzle",
    ],
    facialHairProbability: 33,
    clothing: [
      "blazerAndShirt",
      "blazerAndSweater",
      "collarAndSweater",
      "hoodie",
      "shirtCrewNeck",
      "shirtVNeck",
    ],
  },
  female: {
    top: [
      "longButNotTooLong",
      "straight01",
      "straight02",
      "straightAndStrand",
      "bob",
      "bun",
      "curly",
      "curvy",
      "bigHair",
      "miaWallace",
    ],
    facialHairProbability: 0,
    clothing: [
      "blazerAndShirt",
      "blazerAndSweater",
      "collarAndSweater",
      "shirtScoopNeck",
      "shirtCrewNeck",
      "shirtVNeck",
    ],
  },
  unknown: {
    // No hair/clothing constraint — full diversity for names we cannot classify.
    facialHairProbability: 10,
  },
} as const;

/** Pastel wash used by the avatar picker grid. Off by default. */
const BACKGROUND_COLORS = [
  "b6e3f4",
  "c0aede",
  "d1d4f9",
  "ffd5dc",
  "ffdfbf",
] as const;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface RenderAvatarOptions {
  style: AvatarStyle;
  /** Usually the contact's name; any stable string works. */
  seed: string;
  /** Apply the pastel background wash (the picker does; list avatars do not). */
  background?: boolean;
}

/**
 * Each style declares its own option union, and they do not overlap — there is
 * no shared type that describes "seed plus whatever this style accepts". The
 * values below are validated against the real schemas by the unit tests, which
 * is a stronger guarantee than the structural type would have been.
 */
type AvatarOptions = Record<string, unknown>;

/** Options common to every style. */
function baseOptions(seed: string, background: boolean): AvatarOptions {
  return {
    seed,
    ...(background ? { backgroundColor: [...BACKGROUND_COLORS] } : {}),
  };
}

function renderStyle({ style, seed, background = false }: RenderAvatarOptions) {
  const base = baseOptions(seed, background);

  switch (style) {
    case "avataaars": {
      // Spread each pool into a fresh array: `as const` above keeps the literal
      // element types (which the style's option unions require) but makes the
      // arrays readonly, and DiceBear's options are mutable arrays.
      const preset = GENDER_PRESETS[classifyName(seed)];
      return createAvatar(avataaars, {
        ...base,
        eyebrows: [...FRIENDLY_EYEBROWS],
        eyes: [...FRIENDLY_EYES],
        mouth: [...FRIENDLY_MOUTH],
        skinColor: [...SKIN_COLOR],
        facialHairProbability: preset.facialHairProbability,
        ...("top" in preset ? { top: [...preset.top] } : {}),
        ...("clothing" in preset ? { clothing: [...preset.clothing] } : {}),
      }).toString();
    }
    case "lorelei":
      return createAvatar(lorelei, base).toString();
    case "bottts":
      return createAvatar(bottts, base).toString();
    case "initials":
      return createAvatar(initials, base).toString();
    default:
      // TypeScript proves this is unreachable for well-typed callers, but the
      // style can arrive from a persisted URL or a hand-edited database row.
      // Throwing routes it into the fallback chain below; falling off the end
      // of the switch would return `undefined` and render a broken image.
      throw new Error(`Unknown avatar style "${style}"`);
  }
}

/**
 * Render an avatar to an SVG string.
 *
 * Never throws: a style that fails to compose falls back to `initials`, and if
 * even that fails the caller gets a plain lettered circle. A broken avatar
 * should degrade to a duller avatar, not to a broken image icon in a list of
 * two hundred people.
 */
export function renderAvatar(options: RenderAvatarOptions): string {
  try {
    return renderStyle(options);
  } catch (err) {
    log.warn(
      "Avatar",
      `${options.style} failed for seed "${options.seed}": ${getErrorMessage(err)} — falling back to initials`,
    );
  }

  try {
    return renderStyle({ ...options, style: "initials" });
  } catch (err) {
    log.error(
      "Avatar",
      `initials fallback failed: ${getErrorMessage(err)} — using a plain monogram`,
    );
    return plainMonogram(options.seed);
  }
}

/**
 * Absolute last resort: a hand-built monogram with no library involved, so
 * this path cannot itself fail.
 */
function plainMonogram(seed: string): string {
  const letters =
    seed
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?";
  // Escape for XML: a contact name can legitimately contain & or <.
  const safe = letters.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="#e8eff1"/>` +
    `<text x="50" y="50" dy=".35em" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="42" font-weight="700" fill="#566164">${safe}</text>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

/**
 * The app-relative URL that renders `seed` in `style`.
 *
 * Same-origin by construction — that is the entire point of this module.
 */
export function buildAvatarUrl(
  seed: string,
  style: AvatarStyle = "avataaars",
  options: { background?: boolean } = {},
): string {
  const params = new URLSearchParams({ seed });
  if (options.background) params.set("bg", "1");
  return `/api/avatar/${style}?${params.toString()}`;
}
