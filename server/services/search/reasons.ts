// Server-built reasons for Ask Contrack matches, from the fields that proved
// the match: those a database filter checked, and the one the reranker cited.
// The model writes no sentence (that cost most of the reranker's 3 to 6 s), and
// the text comes from the contact's own fields, so it is exact, short and the
// same on every run.

import { formatDistanceStrict } from "date-fns";

/** A field that proved a match. */
export type ReasonField =
  | "role"
  | "company"
  | "location"
  | "industry"
  | "tag"
  | "interest"
  | "headline"
  | "about"
  | "preferences"
  | "experience"
  | "education"
  | "address"
  | "lastContact";

export interface ReasonEvidence {
  field: ReasonField;
  /**
   * The proving text, when the contact's field alone does not name it: the
   * tag or interest that matched, the role read from a headline, or the
   * passage the reranker quoted from a long field.
   */
  value?: string;
}

/** The contact fields a reason may quote. A hydrated contact has them all. */
export interface ReasonContact {
  [field: string]: unknown;
  role?: unknown;
  headline?: unknown;
  company?: unknown;
  location?: unknown;
  industry?: unknown;
  lastContactedAt?: unknown;
}

/** One reason part, in the form that starts a sentence and the form that follows a comma. */
interface Part {
  lead: string;
  tail: string;
}

/** A quoted value longer than this is cut, so a reason stays one line. */
const MAX_VALUE = 80;

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const clip = (value: string): string =>
  value.length > MAX_VALUE
    ? `${value.slice(0, MAX_VALUE - 1).trimEnd()}…`
    : value;

const upperFirst = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

/** A part whose words come from a template: "Based in X" and "based in X". */
const templated = (words: string, value: string): Part => ({
  lead: `${upperFirst(words)} ${value}`,
  tail: `${words} ${value}`,
});

/** A part that is the contact's own text, such as a role: kept as written. */
const literal = (value: string): Part => ({
  lead: upperFirst(value),
  tail: value,
});

/**
 * The contact's last-contact date, or null. Contrack writes ISO strings. A
 * SQLite `datetime()` value ("2026-05-01 10:00:00") is UTC, so it gets a Z.
 */
function contactDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 months ago", or null when no contact is logged. */
export function lastContactAgo(at: unknown, now: Date): string | null {
  const date = contactDate(at);
  if (!date) return null;
  const distance = formatDistanceStrict(date, now, { roundingMethod: "floor" });
  return `${distance} ago`;
}

function lastContactPart(at: unknown, now: Date): Part {
  const ago = lastContactAgo(at, now);
  return ago
    ? templated("last contact", ago)
    : templated("no contact", "logged");
}

/**
 * One short sentence that says why a contact matches. `evidence` names the
 * fields a filter or the reranker proved, most important first. A role and a
 * company merge into "Product Manager at Northwind Logistics". At most two
 * parts are joined, such as "Product Manager at Northwind Logistics, based in
 * Lisbon, Portugal." A proven field empty on the contact adds nothing. Null
 * when nothing is left to say, and the card shows no reason line.
 */
export function buildReason(
  contact: ReasonContact,
  evidence: ReasonEvidence[],
  now: Date = new Date(),
): string | null {
  const proven = new Set(evidence.map((item) => item.field));
  const company = clip(text(contact.company));
  const parts: Part[] = [];
  const seen = new Set<ReasonField>();

  for (const item of evidence) {
    if (seen.has(item.field)) continue;
    seen.add(item.field);
    const value = clip(text(item.value));
    switch (item.field) {
      case "role": {
        const role =
          value || clip(text(contact.role) || text(contact.headline));
        if (!role) break;
        if (proven.has("company") && company) {
          seen.add("company");
          parts.push(literal(`${role} at ${company}`));
        } else parts.push(literal(role));
        break;
      }
      case "company":
        if (company) parts.push(templated("works at", company));
        break;
      case "location": {
        const location = clip(text(contact.location));
        if (location) parts.push(templated("based in", location));
        break;
      }
      case "industry": {
        const industry = value || clip(text(contact.industry));
        if (industry) parts.push(templated("works in", industry));
        break;
      }
      case "tag":
        if (value) parts.push(templated("tagged", value));
        break;
      case "interest":
        if (value) parts.push(templated("interested in", value));
        break;
      case "headline":
        if (value) parts.push(literal(value));
        break;
      case "about":
      case "preferences":
        if (value) parts.push(templated("profile mentions", `“${value}”`));
        break;
      case "experience":
        if (value)
          parts.push(templated("employment record mentions", `“${value}”`));
        break;
      case "education":
        if (value)
          parts.push(templated("education record mentions", `“${value}”`));
        break;
      case "address":
        if (value) parts.push(templated("has an address at", value));
        break;
      case "lastContact":
        parts.push(lastContactPart(contact.lastContactedAt, now));
        break;
    }
  }

  if (!parts.length) return null;
  const sentence = parts
    .slice(0, 2)
    .map((part, index) => (index === 0 ? part.lead : part.tail))
    .join(", ");
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
