/**
 * A statement ends without a period.
 *
 * The line under a page's title, a row's description, a field's hint, an
 * empty state's body, a card's subtitle and a dialog's description are
 * statements, and the app writes them without a closing period: "Find and
 * merge contacts that are the same person", not "... the same person.". A
 * statement of several sentences keeps the periods between them and drops
 * the last one. The app used to do both, sometimes on one page.
 *
 * The scan reads every file under src/: the props those statements travel
 * in, the text between tags, and every sentence written as a string (a
 * toast, an error, a banner). It reads the registry and the destination
 * names at run time. An ellipsis ("Searching…", "Loading...") is not a
 * period.
 *
 * Words a person hears and never reads keep their period, because a speech
 * engine ends a sentence on it: an accessible name, the search's live
 * region and the drag announcements. Two strings copy another system's words
 * exactly, and keep them.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_PAGES } from "../../src/views/settings/registry";
import { NAMES } from "../../src/lib/names";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "../../src");

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);
  return files;
}

/**
 * A statement prop and its string: `description="…"`, `body={"…"}`,
 * `hint={`…`}` or `subtitle: "…"`, with any space or line break before the
 * string, as Prettier leaves a long one.
 */
const STATEMENT =
  /\b(description|body|hint|desc|subtitle)\s*(?:=\s*\{?|:)\s*(["`])((?:(?!\2)[^\\]|\\.)*?)\2/g;

/** Ends with one period, not an ellipsis. */
const endsWithPeriod = (text: string) => /[^.]\.$/.test(text.trim());

/**
 * The last words before a closing tag, on its line or the line above, and a
 * period left alone after an inline element. `</>` closes a fragment.
 */
const TAG_TEXT = [
  />([^<>{}\n]*[^.\s<>{}])\.<\/[A-Za-z]*>/g,
  /([^\s.{}<>/*][^\n<>{}]*[^.\s<>{}])\.\n[ \t]*<\/[A-Za-z]*>/g,
  /<\/(?:Link|a|strong|em|code|span|kbd)>\.\s*\n[ \t]*<\/[A-Za-z]*>/g,
  /\n[ \t]*\.\n[ \t]*<\/[A-Za-z]*>/g,
];

/** A string in quotes, apostrophes or backticks, on one line. */
const LITERAL = /(?<![\w$])(["'`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;

/** A sentence: a capital or an interpolation first, a space, a period last. */
const isSentence = (text: string) =>
  text.length >= 6 &&
  text.includes(" ") &&
  /^(?:[A-Z"'(]|\$\{)/.test(text) &&
  /[A-Za-z0-9)\]}]\.$/.test(text) &&
  !/\b(?:etc|e\.g|i\.e|vs|Inc|Ltd|Co)\.$/.test(text);

/** Files whose every sentence is spoken: a live region, the drag's words. */
const SPOKEN_FILES = new Set([
  "lib/searchAnnouncements.ts",
  "views/pulse/components/PulseGrid.tsx",
]);

/** Lines whose sentence is spoken, or copies another system's words. */
const KEPT_LINES = [
  /aria-/, // an accessible name or description
  /\bDOMException\(/, // the browser's own AbortError message
  /\bWRONG_CREDENTIALS =/, // the server's sign-in error, matched exactly
];

const isComment = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line);

describe("statements", () => {
  it("end without a period in every statement prop under src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(STATEMENT)) {
        if (endsWithPeriod(match[3])) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(
            `${path.relative(SRC, file)}:${line} ${match[1]} "…${match[3].trim().slice(-50)}"`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("end without a period in the text between tags under src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles().filter((f) => f.endsWith(".tsx"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of TAG_TEXT) {
        for (const match of text.matchAll(pattern)) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(
            `${path.relative(SRC, file)}:${line} "…${match[0].trim().slice(-50)}"`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("end without a period in every sentence written as a string under src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const relative = path.relative(SRC, file);
      if (SPOKEN_FILES.has(relative)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isComment(line) || KEPT_LINES.some((kept) => kept.test(line)))
          return;
        for (const match of line.matchAll(LITERAL)) {
          if (isSentence(match[2])) {
            offenders.push(
              `${relative}:${index + 1} "…${match[2].slice(-50)}"`,
            );
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("find a sentence in a string and between tags, and leave code alone", () => {
    expect(isSentence("Could not reset your password.")).toBe(true);
    expect(isSentence("${count} contacts merged.")).toBe(true);
    expect(isSentence("Could not reset your password")).toBe(false);
    expect(isSentence("Loading...")).toBe(false);
    expect(isSentence("Gmail, iCloud, Fastmail, etc.")).toBe(false);
    expect(isSentence("contact.name")).toBe(false);
    const between = (text: string) =>
      TAG_TEXT.some((pattern) => [...text.matchAll(pattern)].length > 0);
    expect(between("<p>Nothing to clean up.</p>")).toBe(true);
    expect(between("<p>\n  Nothing to clean up.\n</p>")).toBe(true);
    expect(between("<>\n  already here stay with it.\n</>")).toBe(true);
    expect(between("<p>Nothing to clean up</p>")).toBe(false);
    expect(between("<p>Searching…</p>")).toBe(false);
  });

  it("end without a period under every settings page's title", () => {
    for (const page of SETTINGS_PAGES) {
      expect(endsWithPeriod(page.description), page.id).toBe(false);
    }
  });

  it("end without a period in every destination's description", () => {
    for (const [key, name] of Object.entries(NAMES)) {
      expect(endsWithPeriod(name.description), key).toBe(false);
    }
  });

  it("tell an ellipsis from a period", () => {
    expect(endsWithPeriod("Searching…")).toBe(false);
    expect(endsWithPeriod("Loading...")).toBe(false);
    expect(endsWithPeriod("Try other words.")).toBe(true);
    expect(endsWithPeriod("Try other words")).toBe(false);
  });
});
