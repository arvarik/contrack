// =============================================================================
// Unit: the unit project never opens the checkout's own curator.db
// =============================================================================
// Four unit test files unmock server/db.ts. With DATA_DIR unset, the real module
// opened ./curator.db, which is the developer's own data, and every
// `npm test` added test accounts, contacts and links to it. tests/setup.ts
// now gives each unit test file a temp DATA_DIR, and server/db.ts refuses to
// open the fallback under Vitest.
// =============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("the unit project's database", () => {
  it("lives in a temp DATA_DIR, not in the checkout", () => {
    const dataDir = process.env.DATA_DIR;
    expect(dataDir).toBeTruthy();
    const resolved = path.resolve(dataDir!);
    expect(resolved.startsWith(path.resolve(tmpdir()))).toBe(true);
    expect(resolved).not.toBe(ROOT);
    expect(resolved).not.toBe(path.resolve(process.cwd()));
  });

  it("refuses the ./curator.db fallback when Vitest runs it with no DATA_DIR", () => {
    // The real module, in a child process with no DATA_DIR. The fallback is
    // relative to the working directory, so the child runs in a fresh temp
    // folder: without the guard it opens a stray curator.db there, never the
    // checkout's.
    const cwd = mkdtempSync(path.join(tmpdir(), "contrack-db-guard-"));
    try {
      expect(cwd).not.toBe(ROOT);
      expect(cwd.startsWith(ROOT + path.sep)).toBe(false);
      const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "true" };
      delete env.DATA_DIR;
      const db = pathToFileURL(path.join(ROOT, "server/db.ts")).href;
      // The child's limit is below this test's, so a child that hangs fails
      // on its exit status, not on the test timeout.
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `await import(${JSON.stringify(db)})`],
        { cwd, env, encoding: "utf8", timeout: 15_000 },
      );
      expect(child.status).toBeGreaterThan(0);
      expect(child.stderr).toContain("DATA_DIR is not set under Vitest");
      expect(existsSync(path.join(cwd, "curator.db"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 20_000);
});
