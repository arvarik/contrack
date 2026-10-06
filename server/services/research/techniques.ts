// The ways a run can find facts, by name:
//
//   provider-search  the research model's own web search
//   search-and-read  a web search, whose pages the deep model reads
//   combined         both at once, with the facts of both kept
//
// A new technique is one entry here. Its `needs()` says what a start needs set
// up, so the start checks it with the others (`choice.ts`).

import { AppError } from "../../utils/AppError.ts";
import type { Technique } from "./types.ts";
import { providerSearch } from "./techniques/providerSearch.ts";
import { searchAndRead } from "./techniques/searchAndRead.ts";
import { combined } from "./techniques/combined.ts";

const TECHNIQUES = new Map<string, Technique>(
  [providerSearch, searchAndRead, combined].map((technique) => [
    technique.name,
    technique,
  ]),
);

/** A technique that a test put beside the registered ones. */
let replacement: Technique | null = null;

/**
 * Use `technique` for its name, beside the registered ones or in place of the
 * one with the same name. Null goes back. Tests only.
 */
export function setTechnique(technique: Technique | null): void {
  replacement = technique;
}

/** The technique with this name, or undefined. */
function findTechnique(name: string): Technique | undefined {
  return replacement?.name === name ? replacement : TECHNIQUES.get(name);
}

/** True when a technique has this name. */
export function isTechnique(name: string): boolean {
  return findTechnique(name) !== undefined;
}

/** The technique with this name. Throws 400 for a name nothing has. */
export function techniqueNamed(name: string): Technique {
  const technique = findTechnique(name);
  if (!technique)
    throw new AppError(
      `Unknown research technique: "${name}". Available: ${[...TECHNIQUES.keys()].join(", ")}`,
      400,
    );
  return technique;
}

/** True when the technique searches with a web search of its own. */
export function searchesWeb(technique: Technique): boolean {
  return technique.needs().some((need) => need.what === "web-search");
}
