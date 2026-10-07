// Unit: the AI page is named once: Settings → Administration → AI providers.
// Text that sends people to "Settings → AI" (a log line an operator reads
// after a failed boot, a comment in .env.example) points at a page that does
// not exist. "Settings → AI usage" is a real page, so it stays. The changelog
// keeps the earlier name, because it says what each release did.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const STALE = /Settings → AI(?! usage)/;

/** The folders and files whose text a person or an operator can read. */
const PLACES = [
  "src",
  "server",
  "shared",
  "scripts",
  "tests",
  "server.ts",
  ".env.example",
  "README.md",
  "CONTRIBUTING.md",
];

function textFiles(entry: string): string[] {
  const full = path.join(ROOT, entry);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap((name) => textFiles(path.join(entry, name)));
}

describe("the name of the AI settings page", () => {
  it("is never the pre-2.0 name", () => {
    const stale: string[] = [];
    for (const file of PLACES.flatMap(textFiles)) {
      if (file === import.meta.filename) continue;
      if (!/\.(ts|tsx|md|example)$/.test(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (STALE.test(line)) {
            stale.push(`${path.relative(ROOT, file)}:${index + 1}`);
          }
        });
    }
    expect(stale).toEqual([]);
  });
});
