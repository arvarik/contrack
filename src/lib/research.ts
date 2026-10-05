/**
 * How the dossier's Research card words a research record
 * (shared/researchRecord.ts): model names, field names, one line per run,
 * and a source's link text. And, when research found no page, what it
 * searched with and which details would help it (`researchedWith`,
 * `missingAnchors`), by the prompt's own rules (shared/researchIdentity.ts).
 */
import type { ResearchRun, ResearchSource } from "../../shared/researchRecord";
import {
  formerNames,
  placeFromAddresses,
  workEmailDomain,
} from "../../shared/researchIdentity";
import type { Contact } from "../types";

/**
 * "gemini-3.8-flash" reads "Gemini 3.8 Flash", "claude-haiku-4-5-20251001"
 * "Claude Haiku 4.5", "gpt-6-sol" "GPT-6 Sol". An id of another shape is
 * shown as it is.
 */
export function modelName(id: string): string {
  const parts = id
    .toLowerCase()
    .replace(/-\d{8}$/, "")
    .split("-")
    .filter(Boolean);
  if (parts.length === 0) return id;
  const words: string[] = [];
  for (const part of parts) {
    const previous = words[words.length - 1];
    // "4", "5" after a name is version 4.5.
    if (
      /^\d$/.test(part) &&
      previous &&
      /\d$/.test(previous) &&
      !previous.includes(".")
    )
      words[words.length - 1] = `${previous}.${part}`;
    else words.push(part);
  }
  const [first, ...rest] = words;
  if (first === "gpt")
    return `GPT-${rest[0] ?? ""}${rest.length > 1 ? ` ${rest.slice(1).map(capital).join(" ")}` : ""}`;
  return [first, ...rest].map(capital).join(" ");
}

const capital = (word: string) =>
  /^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1);

/** The dossier's name for a field a run added to. */
const FIELD_LABELS: Record<string, string> = {
  role: "Role",
  company: "Company",
  headline: "Headline",
  about: "About",
  industry: "Industry",
  website: "Website",
  location: "Location",
  pronouns: "Pronouns",
  birthday: "Birthday",
  emails: "Emails",
  phones: "Phones",
  socialLinks: "Profiles",
  education: "Education",
  experience: "Roles",
  tags: "Tags",
  interests: "Interests",
  attributes: "Facts",
  addresses: "Addresses",
};

/** "education" reads "Education", "experience" "Roles". */
function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * One line for one run: what it did, in the reader's words.
 *
 * "Added 11: Roles ×4, Education ×2, Location…", "Read 6 pages, nothing
 * new", or "No page about this person". A run from before runs were
 * recorded says only that it happened.
 */
export function runSummary(run: ResearchRun): string {
  if (run.models.length === 0) return "Enriched before details were recorded";
  if (run.rejected) return "Someone else with this name, taken back";
  if (run.outcome === "no-public-info") return "No web page about this person";
  const pages = `${run.sourceCount} page${run.sourceCount === 1 ? "" : "s"}`;
  if (run.outcome === "nothing-new") return `Read ${pages}, nothing new`;
  const total = run.added.reduce((sum, entry) => sum + entry.count, 0);
  return `Added ${total} from ${pages}: ${addedInWords(run)}`;
}

/** What a run added, field by field: "Roles ×4, Education ×2, Location". */
export function addedInWords(run: ResearchRun): string {
  return run.added
    .map((entry) =>
      entry.count > 1
        ? `${fieldLabel(entry.field)} ×${entry.count}`
        : fieldLabel(entry.field),
    )
    .join(", ");
}

/** True when a source's title is only its site's name, as Gemini gives it. */
function titleIsDomain(title: string): boolean {
  return !/\s/.test(title) && /^[\w-]+(\.[\w-]+)+$/.test(title);
}

/**
 * The words a source link shows.
 *
 * `title` is the page's title when the provider gave one, and otherwise the
 * address as a trail: "brokercheck.finra.org › individual › summary". `site`
 * is the host, for the icon and the second line.
 */
export function sourceDisplay(source: ResearchSource): {
  title: string;
  site: string;
  trail: string;
} {
  let url: URL | null = null;
  try {
    url = new URL(source.url);
  } catch {
    url = null;
  }
  const site = url ? url.hostname.replace(/^www\./, "") : source.url;
  const segments = url
    ? url.pathname
        .split("/")
        .filter(Boolean)
        .slice(0, 4)
        .map((segment) => {
          let text = segment;
          try {
            text = decodeURIComponent(segment);
          } catch {
            // Keep the raw segment.
          }
          text = text.replace(/\.(html?|php|aspx?|pdf)$/i, "");
          return text.length > 32 ? `${text.slice(0, 31)}…` : text;
        })
    : [];
  const trail = [site, ...segments].join(" › ");
  const title =
    source.title && !titleIsDomain(source.title) ? source.title : trail;
  return { title, site, trail };
}

/** Fields that only describe what research found, not the person's life. */
const SUMMARY_FIELDS = new Set(["headline", "industry", "tags", "about"]);

/**
 * How many details a run added beyond the summary fields it writes from
 * them: "Roles ×3, Education, Headline" is 4.
 */
export function detailsAdded(run: ResearchRun): number {
  return run.added
    .filter((entry) => !SUMMARY_FIELDS.has(entry.field))
    .reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * Why the Research card asks for one more detail, from the latest run, or
 * null when it has no reason to:
 *
 * - `no-page`: the search found no page about the person.
 * - `rejected`: the person said the search found someone else.
 * - `thin`: it added two details or fewer. A run that found nothing new is
 *   not thin: the records may hold all there is.
 */
export type NextStepReason = "no-page" | "rejected" | "thin";

/** The reason the latest run gives, if any (`NextStepReason`). */
export function nextStepReason(
  runs: readonly ResearchRun[],
): NextStepReason | null {
  const last = runs[runs.length - 1];
  if (!last || last.models.length === 0) return null;
  if (last.rejected) return "rejected";
  if (last.outcome === "no-public-info") return "no-page";
  return last.outcome === "added" && detailsAdded(last) <= 2 ? "thin" : null;
}

/**
 * A detail a person can add that helps research find the right person: a
 * school, a city, a name they went by before, an email at their employer,
 * a link of their own. A school and a former name are added in the
 * Research card itself; the rest open their field on the page.
 */
export type ResearchAnchor =
  "school" | "city" | "formerName" | "workEmail" | "link";

/** The contact fields the identity advice reads. */
type IdentityContact = Pick<
  Contact,
  "company" | "role" | "location" | "addresses" | "emails" | "socialLinks"
> & {
  education?: Contact["education"];
  experience?: Contact["experience"];
  attributes?: Contact["attributes"];
};

/** The place research reads: the location, else an address that names a city. */
function placeOf(contact: IdentityContact): string | null {
  return contact.location || placeFromAddresses(contact.addresses);
}

/** "LinkedIn" for "linkedin": a profile's platform, as its owner writes it. */
const PLATFORM_NAMES: Record<string, string> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  x: "X",
  twitter: "X",
  youtube: "YouTube",
  scholar: "Google Scholar",
};

/** "LinkedIn profile" for one link on a named platform, else "link" or "3 links". */
function linkWords(
  links: readonly { platform?: string | null }[],
): string | null {
  if (links.length === 0) return null;
  if (links.length > 1) return `${links.length} links`;
  const name = PLATFORM_NAMES[links[0].platform?.toLowerCase() ?? ""];
  return name ? `${name} profile` : "link";
}

/**
 * The kinds of detail research searched with, beside the name: "company",
 * "role", "LinkedIn profile". Empty when it had the name alone.
 *
 * Kinds, not values. The values are on the page already, and a role such as
 * "Associate, Restructuring Group" or a city such as "Austin, TX" has a
 * comma of its own, which a list of values in a sentence cannot show.
 */
export function researchedWith(contact: IdentityContact): string[] {
  const details: string[] = [];
  if (contact.company) details.push("company");
  if (contact.role) details.push("role");
  if (placeOf(contact)) details.push("city");
  if (contact.experience?.some((job) => !job.isCurrent))
    details.push("past jobs");
  const schools = contact.education?.length ?? 0;
  if (schools > 0) details.push(schools === 1 ? "school" : "schools");
  if (formerNames(contact.attributes).length > 0) details.push("former name");
  const emails = contact.emails ?? [];
  if (emails.some((entry) => workEmailDomain(entry.email)))
    details.push("work email");
  else if (emails.length > 0) details.push("personal email");
  const links = linkWords(contact.socialLinks ?? []);
  if (links) details.push(links);
  return details;
}

/**
 * The details the person could add that would help research, in the order
 * they help most. A school and a city tell two people with one name apart,
 * and a former name finds the pages from before a change of name: the
 * owner knew all three for contacts research found little about
 * (2026-10-05). A LinkedIn profile does not count as a link here: the
 * search research runs does not return LinkedIn pages (2026-09-26).
 */
export function missingAnchors(contact: IdentityContact): ResearchAnchor[] {
  const missing: ResearchAnchor[] = [];
  if (!contact.education?.length) missing.push("school");
  if (!placeOf(contact)) missing.push("city");
  if (formerNames(contact.attributes).length === 0) missing.push("formerName");
  if (!contact.emails?.some((entry) => workEmailDomain(entry.email)))
    missing.push("workEmail");
  if (
    !contact.socialLinks?.some(
      (link) => link.platform?.toLowerCase() !== "linkedin",
    )
  )
    missing.push("link");
  return missing;
}

/** "A, B and C": a list in a sentence. */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
