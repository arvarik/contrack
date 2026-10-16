/**
 * The Docker image removes parse5 (Dockerfile, the runtime stage), because
 * only cheerio's full entry loads it, and the server never needs that entry:
 * cheerio/slim parses HTML and XML with htmlparser2 alone. An import of the
 * full entry boots on a laptop and fails in the image, which the image's
 * smoke import catches only after the merge, since pull requests build no
 * image. This fails the pull request instead.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "../../..");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("imports the Docker image can load", () => {
  it("imports cheerio/slim, never the full entry that needs parse5", () => {
    const offenders = ["server", "shared"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) =>
        /from\s+["']cheerio["']/.test(fs.readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
