// Unit: every link in the docs leads somewhere
// The docs are flat pages in docs/, and docs/README.md is their index. Pages
// link to each other by file and anchor, and to images beside them. A renamed
// heading or a removed page breaks a link without any other test noticing,
// and a reader finds it first. This reads every page the index lists, plus
// the repository README, CONTRIBUTING, AGENTS, SECURITY and the agent notes,
// and checks each relative link and image: the file exists, and an anchor
// names a heading in the page it points at.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractLinks,
  headingSlugs,
  isExternal,
  pageTitle,
  parseIndex,
  splitTarget,
} from "../../../scripts/docs/markdown.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const INDEX = "docs/README.md";

/** The pages the index lists, as paths from the repository root. */
function indexedPages(): string[] {
  return parseIndex(read(INDEX)).flatMap((section) =>
    section.pages.map(({ target }) =>
      path.posix.normalize(path.posix.join("docs", splitTarget(target).file)),
    ),
  );
}

/**
 * The pages at the top of docs/ that belong to the repository. `.gitignore`
 * keeps a few local notes there, and a checkout that has them must still pass.
 */
function docsPages(): string[] {
  const ignored = new Set(
    read(".gitignore")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("docs/") && line.endsWith(".md")),
  );
  return readdirSync(path.join(ROOT, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`)
    .filter((file) => !ignored.has(file));
}

const CHECKED = [
  ...new Set([
    INDEX,
    ...indexedPages(),
    "README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    "SECURITY.md",
    "docs/brand/README.md",
    ...readdirSync(path.join(ROOT, ".agent"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `.agent/${name}`),
  ]),
];

describe("docs", () => {
  it("lists every page in the index", () => {
    const listed = new Set(indexedPages());
    expect(
      docsPages().filter((file) => file !== INDEX && !listed.has(file)),
    ).toEqual([]);
  });

  it("gives every listed page a title", () => {
    expect(indexedPages().filter((file) => !pageTitle(read(file)))).toEqual([]);
  });

  it("links only to files and headings that exist", () => {
    const broken: string[] = [];
    for (const file of CHECKED) {
      for (const link of extractLinks(read(file))) {
        if (isExternal(link.target)) continue;
        const where = `${file}:${link.line} ${link.target}`;
        const { file: target, anchor } = splitTarget(link.target);
        if (target.startsWith("/")) {
          broken.push(`${where} (a path from the root, not the page)`);
          continue;
        }
        const resolved = target
          ? path.posix.normalize(
              path.posix.join(path.posix.dirname(file), decodeURI(target)),
            )
          : file;
        if (!existsSync(path.join(ROOT, resolved))) {
          broken.push(`${where} (no such file)`);
          continue;
        }
        if (
          anchor &&
          resolved.endsWith(".md") &&
          !headingSlugs(read(resolved)).has(anchor)
        )
          broken.push(`${where} (no heading #${anchor})`);
      }
    }
    expect(broken).toEqual([]);
  });
});
