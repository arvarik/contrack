/**
 * wiki: write the docs as a GitHub wiki.
 *
 *   npm run docs:wiki -- <folder> [--ref <branch>]
 *
 * The docs are written for the repository: flat pages in `docs/`, relative
 * links such as `pulse.md#track-a-contact`, and images beside them. A GitHub
 * wiki names a page by its file without the extension and links to it the
 * same way, so a copy of the folder would break every link. This writes a
 * folder that a wiki can take as it is:
 *
 *   Home.md        docs/README.md
 *   <Page>.md      one file per page the index lists, named from its title
 *   _Sidebar.md    the index's sections and pages
 *   _Footer.md     where the pages come from
 *   images/ ...    every image and file a page links to under docs/
 *
 * A link to another page becomes that page's wiki name, with its anchor. An
 * image or other file under `docs/` is copied beside the pages. A link to
 * anything else in the repository, a Markdown file the index does not list
 * included, becomes its address on GitHub at `--ref` (default `main`). Web
 * links are left alone. The folder is meant to be the working tree of
 * `<repo>.wiki.git`: write, review the diff, commit.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  extractLinks,
  isExternal,
  pageTitle,
  parseIndex,
  splitTarget,
} from "./markdown.ts";

const REPO_URL = "https://github.com/arvarik/contrack";

/** A wiki page name from a title: words joined by dashes, no punctuation. */
export function wikiName(title: string): string {
  return title
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

interface WikiPage {
  /** The source file, relative to the repository root. */
  source: string;
  /** The wiki file name without `.md`. */
  name: string;
}

interface BuildOptions {
  repoRoot: string;
  outDir: string;
  ref?: string;
}

/** Every page the wiki holds, keyed by its source path. Home comes first. */
function collectPages(repoRoot: string): Map<string, WikiPage> {
  const homeSource = "docs/README.md";
  const pages = new Map<string, WikiPage>([
    [homeSource, { source: homeSource, name: "Home" }],
  ]);
  const home = readFileSync(path.join(repoRoot, homeSource), "utf8");
  for (const section of parseIndex(home)) {
    for (const { target } of section.pages) {
      const source = path.posix.normalize(
        path.posix.join("docs", splitTarget(target).file),
      );
      const text = readFileSync(path.join(repoRoot, source), "utf8");
      const title = pageTitle(text) ?? path.posix.basename(source, ".md");
      pages.set(source, { source, name: wikiName(title) });
    }
  }
  return pages;
}

/**
 * One page's text with every link pointed at the wiki. Files under `docs/`
 * that are not pages are copied beside the pages, keeping their path.
 */
function rewritePage(
  page: WikiPage,
  text: string,
  pages: Map<string, WikiPage>,
  { repoRoot, outDir, ref = "main" }: BuildOptions,
): string {
  const replacements = new Map<string, string>();
  for (const link of extractLinks(text)) {
    if (isExternal(link.target) || link.target.startsWith("#")) continue;
    const { file, anchor } = splitTarget(link.target);
    const source = path.posix.normalize(
      path.posix.join(path.posix.dirname(page.source), file),
    );
    const hash = anchor ? `#${anchor}` : "";
    const target = pages.get(source);
    if (target) {
      replacements.set(link.target, `${target.name}${hash}`);
    } else if (
      source.startsWith("docs/") &&
      !source.endsWith(".md") &&
      existsSync(path.join(repoRoot, source))
    ) {
      const copy = source.slice("docs/".length);
      mkdirSync(path.dirname(path.join(outDir, copy)), { recursive: true });
      copyFileSync(path.join(repoRoot, source), path.join(outDir, copy));
      replacements.set(link.target, `${copy}${hash}`);
    } else {
      replacements.set(link.target, `${REPO_URL}/blob/${ref}/${source}${hash}`);
    }
  }
  // Replace inside the link syntax only, so prose that happens to repeat a
  // path is left as written.
  return text.replace(
    /(\]\(\s*<?|\b(?:src|srcset|href)=")([^)\s>"]+)/g,
    (whole, lead: string, target: string) =>
      replacements.has(target) ? `${lead}${replacements.get(target)}` : whole,
  );
}

/** The sidebar: each index section, then its pages by wiki name. */
function sidebar(pages: Map<string, WikiPage>, repoRoot: string): string {
  const home = readFileSync(path.join(repoRoot, "docs/README.md"), "utf8");
  const lines = ["**[Home](Home)**", ""];
  for (const section of parseIndex(home)) {
    lines.push(`**${section.title}**`, "");
    for (const { title, target } of section.pages) {
      const source = path.posix.normalize(
        path.posix.join("docs", splitTarget(target).file),
      );
      lines.push(`- [${title}](${pages.get(source)!.name})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Write the wiki into `outDir`. Returns the page names it wrote. */
export function buildWiki(options: BuildOptions): string[] {
  const { repoRoot, outDir } = options;
  mkdirSync(outDir, { recursive: true });
  const pages = collectPages(repoRoot);
  for (const page of pages.values()) {
    const text = readFileSync(path.join(repoRoot, page.source), "utf8");
    writeFileSync(
      path.join(outDir, `${page.name}.md`),
      rewritePage(page, text, pages, options),
    );
  }
  writeFileSync(path.join(outDir, "_Sidebar.md"), sidebar(pages, repoRoot));
  writeFileSync(
    path.join(outDir, "_Footer.md"),
    `These pages are written from \`docs/\` in [arvarik/contrack](${REPO_URL}). Change the source, then run \`npm run docs:wiki\` again.\n`,
  );
  return [...pages.values()].map((page) => page.name);
}

const runDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (runDirectly) {
  const args = process.argv.slice(2);
  const refAt = args.indexOf("--ref");
  const ref = refAt === -1 ? undefined : args[refAt + 1];
  const outDir = args.find(
    (arg, i) => !arg.startsWith("--") && args[i - 1] !== "--ref",
  );
  if (!outDir) {
    console.error("Usage: npm run docs:wiki -- <folder> [--ref <branch>]");
    process.exit(1);
  }
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const names = buildWiki({ repoRoot, outDir: path.resolve(outDir), ref });
  console.log(`Wrote ${names.length} pages to ${path.resolve(outDir)}`);
}
