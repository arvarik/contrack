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
import { classifyName, type AvatarLook } from "../utils/smartAvatar.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { monogramSvg, type MonogramTheme } from "../../shared/monogram.ts";

export type { AvatarLook } from "../utils/smartAvatar.ts";
// URL building lives in utils/avatarUrl.ts, which loads no artwork, so the
// database's boot migration can use it. Re-exported for existing callers.
export {
  buildAvatarUrl,
  defaultAvatarUrl,
  isDefaultAvatarFor,
  parseAvatarLook,
} from "../utils/avatarUrl.ts";

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
 * is silent: DiceBear ignores an option value it does not recognize, so a
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
 * Asset pools for the three looks smartAvatar can pick.
 *
 * The seed still picks within a pool, so two people with the same look get
 * different faces. The neutral pool is for names the data cannot call and for
 * pronouns other than he or she: no facial hair, the short and textured hair
 * that reads either way, no scoop neck, and no pastel pink hair, which reads
 * female. It used to be the unconstrained pool, which gave one ambiguous name
 * in ten a beard.
 *
 * `shavedSides` left the male pool: it is long hair swept to one side, and it
 * read female on one man in ten.
 */
const LOOK_PRESETS = {
  male: {
    top: [
      "shortFlat",
      "shortRound",
      "shortWaved",
      "shortCurly",
      "theCaesar",
      "theCaesarAndSidePart",
      "sides",
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
  neutral: {
    top: [
      "bun",
      "fro",
      "dreads01",
      "dreads02",
      "frizzle",
      "shaggy",
      "shaggyMullet",
      "shortCurly",
      "winterHat02",
      "winterHat03",
    ],
    facialHairProbability: 0,
    clothing: [
      "blazerAndShirt",
      "blazerAndSweater",
      "collarAndSweater",
      "hoodie",
      "shirtCrewNeck",
      "shirtVNeck",
    ],
    // DiceBear's palette without its pastel pink, f59797.
    hairColor: [
      "a55728",
      "2c1b18",
      "b58143",
      "d6b370",
      "724133",
      "4a312c",
      "ecdcbf",
      "c93305",
      "e8e1e1",
    ],
  },
} as const satisfies Record<
  AvatarLook,
  {
    top: readonly string[];
    facialHairProbability: number;
    clothing: readonly string[];
    hairColor?: readonly string[];
  }
>;

/** Every look, for the tests that check each pool against DiceBear's schema. */
export const AVATAR_LOOK_POOLS = LOOK_PRESETS;

/** Pastel wash used by the avatar picker grid. Off by default. */
const BACKGROUND_COLORS = [
  "b6e3f4",
  "c0aede",
  "d1d4f9",
  "ffd5dc",
  "ffdfbf",
] as const;

/**
 * The same five hues, deep enough to sit in a dark card.
 *
 * The pastels above are backgrounds rather than text, so they carry no
 * contrast duty — but five bright squares in a grid on a near-black page are
 * the brightest thing on screen, which is not what a picker should be.
 */
const BACKGROUND_COLORS_DARK = [
  "14405a",
  "3b2f5c",
  "2b3163",
  "5b2733",
  "5c3a18",
] as const;

/** Which palette an avatar is being drawn for. */
export type AvatarTheme = MonogramTheme;

export function isAvatarTheme(value: unknown): value is AvatarTheme {
  return value === "light" || value === "dark";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface RenderAvatarOptions {
  style: AvatarStyle;
  /** Usually the contact's name; any stable string works. */
  seed: string;
  /** Apply the pastel background wash (the picker does; list avatars do not). */
  background?: boolean;
  /**
   * Which palette to draw for.
   *
   * Undefined means "decide in the browser": the monogram then carries its own
   * `prefers-color-scheme` rule, which is the right answer for the default
   * `system` theme and needs no request parameter at all. A value pins it,
   * which is what a person who chose light or dark explicitly needs.
   */
  theme?: AvatarTheme;
  /**
   * Which pool the illustrated style draws from. Undefined means "read it
   * from the seed", which is right for a name. A contact's pronouns arrive
   * here, because the seed alone cannot carry them.
   */
  look?: AvatarLook;
}

/**
 * Each style declares its own option union, and they do not overlap — there is
 * no shared type that describes "seed plus whatever this style accepts". The
 * values below are validated against the real schemas by the unit tests, which
 * is a stronger guarantee than the structural type would have been.
 */
type AvatarOptions = Record<string, unknown>;

/** Options common to every style. */
function baseOptions(
  seed: string,
  background: boolean,
  theme: AvatarTheme | undefined,
): AvatarOptions {
  return {
    seed,
    ...(background
      ? {
          backgroundColor: [
            ...(theme === "dark" ? BACKGROUND_COLORS_DARK : BACKGROUND_COLORS),
          ],
        }
      : {}),
  };
}

function renderStyle({
  style,
  seed,
  background = false,
  theme,
  look,
}: RenderAvatarOptions) {
  const base = baseOptions(seed, background, theme);

  switch (style) {
    case "avataaars": {
      // Spread each pool into a fresh array: `as const` above keeps the literal
      // element types (which the style's option unions require) but makes the
      // arrays readonly, and DiceBear's options are mutable arrays.
      const preset = LOOK_PRESETS[look ?? classifyName(seed)];
      return createAvatar(avataaars, {
        ...base,
        eyebrows: [...FRIENDLY_EYEBROWS],
        eyes: [...FRIENDLY_EYES],
        mouth: [...FRIENDLY_MOUTH],
        skinColor: [...SKIN_COLOR],
        facialHairProbability: preset.facialHairProbability,
        top: [...preset.top],
        clothing: [...preset.clothing],
        ...("hairColor" in preset ? { hairColor: [...preset.hairColor] } : {}),
      }).toString();
    }
    case "lorelei":
      return createAvatar(lorelei, base).toString();
    case "bottts":
      return createAvatar(bottts, base).toString();
    case "initials":
      return monogramSvg(seed, theme);
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
      `${options.style} failed: ${getErrorMessage(err)} — falling back to initials`,
    );
  }

  try {
    return renderStyle({ ...options, style: "initials" });
  } catch (err) {
    log.error(
      "Avatar",
      `initials fallback failed: ${getErrorMessage(err)} — using a plain monogram`,
    );
    // The last resort: `shared/monogram.ts` builds it by hand, with no
    // library, so this path cannot itself fail.
    return monogramSvg(options.seed, options.theme);
  }
}
