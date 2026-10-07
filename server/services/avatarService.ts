// Deterministic avatar SVGs, generated in-process. The DiceBear packages carry
// the artwork and compose the SVG by computation, so no contact name goes to a
// third party and avatars work offline. The same name always gives the same
// face, in about a millisecond. Nothing is written to disk: the output is a
// pure function of (style, seed), so HTTP caching on the route is the whole
// cache (routes/avatar.ts).

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

// Expression presets

/**
 * Friendly-face constraints for avataaars. Eyebrows and eyes are constrained as
 * well as the mouth, so no contact scowls out of the address book with `angry`
 * brows over a `serious` mouth. Avatars should be neutral to warm.
 *
 * Excluded on purpose:
 *   eyebrows: angry, angryNatural, frownNatural, sadConcerned,
 *             sadConcernedNatural, unibrowNatural
 *   eyes:     cry, xDizzy, eyeRoll, squint, closed (asleep), hearts (odd in a
 *             professional context), vomit-adjacent expressions
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

/** Mouths, all friendly already. */
export const FRIENDLY_MOUTH = ["default", "smile", "serious"] as const;

/**
 * Expressions that must never reach a contact's face. The tests assert this,
 * because the failure is silent: DiceBear ignores an option value it does not
 * recognize, so one typo in the allow lists above would quietly restore the
 * whole pool, angry brows included.
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
 * Asset pools for the three looks smartAvatar can pick. The seed still picks
 * within a pool, so two people with one look get different faces. The neutral
 * pool is for names the data cannot call and pronouns other than he or she: no
 * facial hair, short and textured hair that reads either way, no scoop neck,
 * and no pastel pink hair, which reads female. `shavedSides` is not in the male
 * pool: it is long hair swept to one side, which read female on one man in ten.
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
 * The same five hues, deep enough for a dark card. The pastels are backgrounds,
 * with no contrast duty, but five bright squares on a near-black page would be
 * the brightest thing on screen.
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

// Generation

export interface RenderAvatarOptions {
  style: AvatarStyle;
  /** Usually the contact's name; any stable string works. */
  seed: string;
  /** Apply the pastel background wash (the picker does; list avatars do not). */
  background?: boolean;
  /**
   * Which palette to draw for. Undefined means "decide in the browser": the
   * monogram carries its own `prefers-color-scheme` rule, right for the default
   * `system` theme. A value pins it, for a person who chose light or dark.
   */
  theme?: AvatarTheme;
  /**
   * Which pool the illustrated style draws from. Undefined reads it from the
   * seed, which is right for a name. A contact's pronouns arrive here, because
   * the seed cannot carry them.
   */
  look?: AvatarLook;
}

/**
 * Each style declares its own option union, and no shared type describes "seed
 * plus whatever this style accepts". The unit tests check the values below
 * against the real schemas instead.
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
      // Spread each pool into a fresh array: `as const` keeps the literal types
      // the style's options need but makes the arrays readonly, and DiceBear's
      // options are mutable arrays.
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
      // Unreachable for well-typed callers, but the style can come from a
      // persisted URL or a hand-edited row. Throwing reaches the fallback chain
      // below; falling off the switch would return `undefined` and a broken
      // image.
      throw new Error(`Unknown avatar style "${style}"`);
  }
}

/**
 * Render an avatar to an SVG string. Never throws: a style that fails falls
 * back to `initials`, and if that fails too the caller gets a plain lettered
 * circle, a duller avatar rather than a broken image in a list of two hundred.
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
