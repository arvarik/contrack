/**
 * Smart Avatar — name → gender classification for avatar styling.
 *
 * Uses a local name-gender lookup table (~40K entries) to classify first names
 * as masculine/feminine/unknown, so avatar generation can pick from a matching
 * pool of hair and clothing assets. Zero API calls, ~0.01ms per name,
 * deterministic, and unclassifiable names simply get the unconstrained pool.
 *
 * The asset pools themselves live in services/avatarService, because they are
 * now applied when the SVG is rendered rather than encoded into a URL. This
 * module used to build `api.dicebear.com` URLs; that put every contact's name
 * in an outbound request, and is gone.
 */

import { getGender } from "gender-detection-from-name";

/** The three asset pools avatarService keys off. */
export type GenderPreset = "male" | "female" | "unknown";

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
