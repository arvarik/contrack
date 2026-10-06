/**
 * The words for the two research depths, the same in every control that
 * starts research. Standard, the default, is one plain search ask, and it
 * found something for 17 of 20 contacts. Deep adds the long prompt, which
 * reads further: facts for 19 of 20, and about two fifths more of them, at
 * about one and a half times the cost. The times and costs are the measured
 * figures in `shared/researchDepth.ts`.
 */
import {
  RESEARCH_DEPTH_FIGURES,
  type ResearchDepth,
} from "../../shared/researchDepth";

/** The depths in the order a control lists them: the default first. */
export const DEPTH_ORDER: readonly ResearchDepth[] = ["standard", "deep"];

/** Each depth's name, and what it does in a few words. */
export const DEPTH_WORDS: Record<
  ResearchDepth,
  { name: string; does: string }
> = {
  standard: {
    name: "Standard",
    does: "One search for roles, schools, city and profiles",
  },
  deep: {
    name: "Deep",
    does: "Adds a second search that reads further",
  },
};

/** "about 40 s", "about 1 min": the time a contact takes, for a menu row. */
export function aboutTime(seconds: number): string {
  if (seconds < 55)
    return `about ${Math.max(10, Math.round(seconds / 10) * 10)} s`;
  return `about ${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "$0.12", or "under $0.01". */
export function dollars(amount: number): string {
  return amount < 0.01 ? "under $0.01" : `$${amount.toFixed(2)}`;
}

/** The time one contact takes at this depth: "about 30 s". */
export function depthTime(depth: ResearchDepth): string {
  return aboutTime(RESEARCH_DEPTH_FIGURES[depth].seconds);
}

/** "About 30 s and $0.12 a contact", for a tile under the depth's name. */
export function perContact(depth: ResearchDepth): string {
  const figures = RESEARCH_DEPTH_FIGURES[depth];
  return `${sentence(aboutTime(figures.seconds))} and ${dollars(figures.costUsd)} a contact`;
}

/**
 * "About 6 min and $1.44 in all", for this many contacts at this depth.
 * Contacts run one after another, with a pause of 2.5 s between them.
 */
export function batchEstimate(depth: ResearchDepth, count: number): string {
  const figures = RESEARCH_DEPTH_FIGURES[depth];
  const seconds = count * figures.seconds + Math.max(0, count - 1) * 2.5;
  return `${sentence(aboutTime(seconds))} and ${dollars(count * figures.costUsd)} in all`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
