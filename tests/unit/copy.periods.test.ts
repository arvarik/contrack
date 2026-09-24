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
 * The scan reads the props those statements travel in, in every file under
 * src/, and the registry and the destination names at run time. An ellipsis
 * ("Searching…", "Loading...") is not a period.
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
