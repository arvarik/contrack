/**
 * How the dossier's Research card words a research record
 * (shared/researchRecord.ts): model names, field names, one line per run,
 * and a source's link text.
 */
import type { ResearchRun, ResearchSource } from "../../shared/researchRecord";

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
export function fieldLabel(field: string): string {
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
  if (run.outcome === "no-public-info") return "No web page about this person";
  const pages = `${run.sourceCount} page${run.sourceCount === 1 ? "" : "s"}`;
  if (run.outcome === "nothing-new") return `Read ${pages}, nothing new`;
  const total = run.added.reduce((sum, entry) => sum + entry.count, 0);
  const parts = run.added.map((entry) =>
    entry.count > 1
      ? `${fieldLabel(entry.field)} ×${entry.count}`
      : fieldLabel(entry.field),
  );
  return `Added ${total} from ${pages}: ${parts.join(", ")}`;
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
