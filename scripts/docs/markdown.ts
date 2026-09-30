/**
 * markdown: the small parts of Markdown that the docs tooling reads.
 *
 * The docs are plain Markdown pages in `docs/`, and `docs/README.md` is their
 * index. Two readers need the same answers from them: the unit test that
 * holds every link and anchor true, and `scripts/docs/wiki.ts`, which writes
 * the pages as a GitHub wiki. So the rules live here once:
 *
 *   slugify        the anchor GitHub gives a heading
 *   headingSlugs   every anchor a page has, duplicates numbered as GitHub does
 *   extractLinks   every link and image a page points at, outside code
 *   parseIndex     the sections and pages that `docs/README.md` lists
 *
 * This is not a Markdown parser. It reads the forms the docs use: ATX
 * headings, inline links and images, and the `src`, `srcset` and `href`
 * attributes that the repository README writes in HTML.
 */

/** The anchor GitHub gives a heading: lower case, spaces to dashes. */
export function slugify(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The lines of a page, with fenced code blanked so nothing in it is read. */
function proseLines(markdown: string): string[] {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === null || marker.startsWith(fence))) {
      fence = fence === null ? marker : null;
      return "";
    }
    return fence === null ? line : "";
  });
}

/** Every anchor a page offers, as GitHub numbers repeated headings. */
export function headingSlugs(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  for (const line of proseLines(markdown)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (!heading) continue;
    const slug = slugify(heading);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    slugs.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return slugs;
}

export interface MarkdownLink {
  /** What the link points at, as written. */
  target: string;
  /** The text of the link, or the alt text of an image. */
  text: string;
  /** 1-based line number, for a failure message a person can follow. */
  line: number;
  image: boolean;
}

/** Every link and image outside code, in the order they appear. */
export function extractLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  proseLines(markdown).forEach((raw, index) => {
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(
      /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    ))
      links.push({
        target: m[3]!,
        text: m[2]!,
        line: index + 1,
        image: m[1] === "!",
      });
    for (const m of line.matchAll(/\b(src|srcset|href)="([^"]+)"/g)) {
      // A srcset lists candidates, each a URL and an optional width or density.
      const targets =
        m[1] === "srcset"
          ? m[2]!
              .split(",")
              .map((candidate) => candidate.trim().split(/\s+/)[0]!)
          : [m[2]!];
      for (const target of targets)
        links.push({
          target,
          text: "",
          line: index + 1,
          image: m[1] !== "href",
        });
    }
  });
  return links;
}

/** True for a link that leaves the repository: a web address or a mail link. */
export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

/** A target split into its file part and its anchor, both possibly empty. */
export function splitTarget(target: string): { file: string; anchor: string } {
  const hash = target.indexOf("#");
  return hash === -1
    ? { file: target, anchor: "" }
    : { file: target.slice(0, hash), anchor: target.slice(hash + 1) };
}

/** The page's title: its first level-one heading. */
export function pageTitle(markdown: string): string | null {
  for (const line of proseLines(markdown)) {
    const title = /^#\s+(.+?)\s*$/.exec(line)?.[1];
    if (title) return title;
  }
  return null;
}

export interface IndexSection {
  title: string;
  pages: { title: string; target: string }[];
}

/**
 * The sections of `docs/README.md` and the pages each lists: every level-two
 * heading, then the first link of each list item under it. A section with no
 * listed page is left out.
 */
export function parseIndex(markdown: string): IndexSection[] {
  const sections: IndexSection[] = [];
  let current: IndexSection | null = null;
  for (const line of proseLines(markdown)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading) {
      current = { title: heading, pages: [] };
      sections.push(current);
      continue;
    }
    const item = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)/.exec(line);
    if (item && current && !isExternal(item[2]!))
      current.pages.push({ title: item[1]!, target: item[2]! });
  }
  return sections.filter((section) => section.pages.length > 0);
}
