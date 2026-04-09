/**
 * Smart Avatar — Gender-aware DiceBear URL builder.
 *
 * Uses a local name-gender lookup table (~40K entries) to classify
 * first names as masculine/feminine/unknown, then tunes DiceBear
 * avataaars parameters accordingly.
 *
 * - Zero API calls — runs entirely in-process (~0.01ms per name).
 * - Deterministic — same name always produces the same avatar.
 * - Graceful fallback — unknown names use default PRNG seeding.
 *
 * Call `buildSmartAvatarUrl(name)` anywhere an avatar URL is needed.
 */

import { getGender } from "gender-detection-from-name";

// =============================================================================
// DiceBear preset configurations per gender classification
// =============================================================================
// Each preset constrains the PRNG to gender-appropriate asset pools.
// The `seed` parameter still drives the specific selection within each pool,
// so two people with different names but the same gender get different avatars.

const PRESETS = {
  male: {
    top: "shortFlat,shortRound,shortWaved,shortCurly,theCaesar,theCaesarAndSidePart,sides,shavedSides,dreads01,frizzle",
    facialHairProbability: "33",
    clothing: "blazerAndShirt,blazerAndSweater,collarAndSweater,hoodie,shirtCrewNeck,shirtVNeck",
  },
  female: {
    top: "longButNotTooLong,straight01,straight02,straightAndStrand,bob,bun,curly,curvy,bigHair,miaWallace",
    facialHairProbability: "0",
    clothing: "blazerAndShirt,blazerAndSweater,collarAndSweater,shirtScoopNeck,shirtCrewNeck,shirtVNeck",
  },
  unknown: {
    // No top/clothing constraints — full PRNG diversity
    facialHairProbability: "10",
  },
} as const;

type GenderPreset = keyof typeof PRESETS;

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract the first name from a full name string.
 * Handles edge cases: "(Coordinator)" suffixes, "LastName, FirstName" CSV format.
 */
function extractFirstName(fullName: string): string {
  let name = fullName.trim();

  // Remove parenthetical suffixes: "Sabrina Hans (Coordinator)" → "Sabrina Hans"
  name = name.replace(/\s*\(.*?\)\s*/g, "").trim();

  // Handle "LastName, FirstName" format
  if (name.includes(",")) {
    const parts = name.split(",").map((s) => s.trim());
    if (parts.length >= 2 && parts[1]) {
      name = parts[1]; // FirstName is after the comma
    }
  }

  // Take the first word as first name
  return name.split(/\s+/)[0] || name;
}

/**
 * Classify a name and return a gender preset key.
 * Uses the 'en' locale by default for best accuracy on Western names.
 */
export function classifyName(fullName: string): GenderPreset {
  const firstName = extractFirstName(fullName);
  if (!firstName || firstName.length < 2) return "unknown";

  const result = getGender(firstName, "en");

  if (result === "male") return "male";
  if (result === "female") return "female";
  return "unknown";
}

/**
 * Build a DiceBear avataaars URL with gender-appropriate styling.
 *
 * @param name  - The contact's full name (used as seed + for gender classification)
 * @returns     - A deterministic DiceBear SVG URL
 */
export function buildSmartAvatarUrl(name: string): string {
  const gender = classifyName(name);
  const preset = PRESETS[gender];

  // Build query params from the preset
  // Note: URLSearchParams handles encoding automatically — do not pre-encode.
  const params = new URLSearchParams();
  params.set("seed", name);
  params.set("mouth", "default,smile,serious");
  params.set("skinColor", "f8d25c"); // Emoji yellow — neutral default

  if ("top" in preset) {
    params.set("top", preset.top);
  }
  params.set("facialHairProbability", preset.facialHairProbability);
  if ("clothing" in preset) {
    params.set("clothing", preset.clothing);
  }

  return `https://api.dicebear.com/9.x/avataaars/svg?${params.toString()}`;
}
