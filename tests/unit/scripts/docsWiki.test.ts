// =============================================================================
// Unit: the docs tooling reads Markdown the way GitHub does, and writes a wiki
// =============================================================================
// scripts/docs/markdown.ts answers three questions for the docs link test and
// the wiki builder: which anchor a heading gets, which links a page holds, and
// which pages the index lists. scripts/docs/wiki.ts then writes the pages as
// a GitHub wiki. The last test builds the wiki from the real docs, so a page
// that cannot become a wiki page fails here rather than on publish day.
// =============================================================================

import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractLinks,
  headingSlugs,
  parseIndex,
  slugify,
} from "../../../scripts/docs/markdown.ts";
import { buildWiki, wikiName } from "../../../scripts/docs/wiki.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("slugify", () => {
  it("gives a heading the anchor GitHub gives it", () => {
    expect(slugify("Import, sync, and export")).toBe("import-sync-and-export");
    expect(slugify("What a person still checks")).toBe(
      "what-a-person-still-checks",
    );
    expect(slugify("`GET /api/contacts`")).toBe("get-apicontacts");
    expect(slugify("Pulse & tracking")).toBe("pulse--tracking");
    expect(slugify("The [map](map.md) page")).toBe("the-map-page");
  });

  it("numbers a repeated heading and skips code", () => {
    const page = [
      "# Title",
      "## Setup",
      "```bash",
      "## not a heading",
      "```",
      "## Setup",
    ].join("\n");
    expect([...headingSlugs(page)]).toEqual(["title", "setup", "setup-1"]);
  });
});

describe("extractLinks", () => {
  it("reads links, images and HTML sources outside code", () => {
    const page = [
      "See [Pulse](pulse.md#track-a-contact) and ![The map](images/map.png).",
      "Not `[this](nowhere.md)`.",
      "```md",
      "[nor this](nowhere.md)",
      "```",
      '<img src="docs/brand/a.svg" /> <source srcset="b.svg 1x, c.svg 2x" />',
    ].join("\n");
    expect(
      extractLinks(page).map(({ target, image }) => [target, image]),
    ).toEqual([
      ["pulse.md#track-a-contact", false],
      ["images/map.png", true],
      ["docs/brand/a.svg", true],
      ["b.svg", true],
      ["c.svg", true],
    ]);
  });
});

describe("parseIndex", () => {
  it("reads each section's pages from its list", () => {
    const home = [
      "# Docs",
      "Intro with a [link](elsewhere.md).",
      "## Use it",
      "- [Contacts](contacts.md): people",
      "- [Map](map.md): places",
      "## Elsewhere",
      "- [GitHub](https://github.com)",
    ].join("\n");
    expect(parseIndex(home)).toEqual([
      {
        title: "Use it",
        pages: [
          { title: "Contacts", target: "contacts.md" },
          { title: "Map", target: "map.md" },
        ],
      },
    ]);
  });
});

describe("the wiki", () => {
  it("names a page from its title", () => {
    expect(wikiName("Import, sync, and export")).toBe("Import-sync-and-export");
    expect(wikiName("MCP and API tokens")).toBe("MCP-and-API-tokens");
  });

  it("builds from the docs, with links a wiki can follow", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "contrack-wiki-"));
    const names = buildWiki({ repoRoot: ROOT, outDir });

    expect(names[0]).toBe("Home");
    for (const name of names)
      expect(existsSync(path.join(outDir, `${name}.md`)), name).toBe(true);

    const sidebar = readFileSync(path.join(outDir, "_Sidebar.md"), "utf8");
    for (const name of names.slice(1)) expect(sidebar).toContain(`(${name})`);

    const pages = new Set(names);
    const broken: string[] = [];
    for (const file of readdirSync(outDir).filter((f) => f.endsWith(".md"))) {
      for (const { target, line } of extractLinks(
        readFileSync(path.join(outDir, file), "utf8"),
      )) {
        if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
        const bare = target.split("#")[0]!;
        if (!pages.has(bare) && !existsSync(path.join(outDir, bare)))
          broken.push(`${file}:${line} ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
