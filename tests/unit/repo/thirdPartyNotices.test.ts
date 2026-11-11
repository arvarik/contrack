// Unit: the third-party notices are the ones the build and the lockfile call
// for. public/third-party-notices.txt names every package the build bundles
// into dist/ and every production package the Docker image installs, with
// its licence and its licence files, and the build copies it into dist/. A
// dependency that changes without `npm run notices` would ship code with no
// notice, so this builds the file again and compares.
//
// The generator reads the Linux x64 build of a platform package, so the test
// runs on Linux x64, as CI does. Elsewhere it is skipped.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NOTICES_FILE,
  buildNotices,
} from "../../../scripts/third-party-notices.ts";

/** The first line where two texts differ, with its number, or null. */
function firstDifference(committed: string, built: string): string | null {
  const a = committed.split("\n");
  const b = built.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: committed ${JSON.stringify(a[i])}, built ${JSON.stringify(b[i])}. Run npm run notices`;
    }
  }
  return null;
}

describe("public/third-party-notices.txt", () => {
  it.runIf(process.platform === "linux" && process.arch === "x64")(
    "is what npm run notices writes from the build and the lockfile",
    async () => {
      const built = await buildNotices();
      expect(
        firstDifference(readFileSync(NOTICES_FILE, "utf8"), built),
      ).toBeNull();
      // The two LGPL libraries and the texts the LGPL needs beside them.
      expect(built).toMatch(/^heic-to \S+ {2}LGPL-3\.0/m);
      expect(built).toMatch(/^@img\/sharp-libvips-linux-x64 \S+ {2}LGPL/m);
      expect(built).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
      expect(built).toContain("GNU GENERAL PUBLIC LICENSE");
    },
    60_000,
  );
});
