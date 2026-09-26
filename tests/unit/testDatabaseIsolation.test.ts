// =============================================================================
// Unit: the unit project never opens the checkout's own curator.db
// =============================================================================
// Three unit tests unmock server/db.ts. With DATA_DIR unset, the real module
// opened ./curator.db, which is the developer's own data, and every
// `npm test` added test accounts, contacts and links to it. tests/setup.ts
// now gives each unit test file a temp DATA_DIR, and server/db.ts refuses to
// open the fallback under Vitest.
// =============================================================================

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("the unit project's database", () => {
  it("lives in a temp DATA_DIR, not in the checkout", () => {
    const dataDir = process.env.DATA_DIR;
    expect(dataDir).toBeTruthy();
    const resolved = path.resolve(dataDir!);
    expect(resolved.startsWith(path.resolve(tmpdir()))).toBe(true);
    expect(resolved).not.toBe(ROOT);
    expect(resolved).not.toBe(path.resolve(process.cwd()));
  });

  it("is guarded in server/db.ts against the ./curator.db fallback", () => {
    const source = readFileSync(path.join(ROOT, "server/db.ts"), "utf8");
    const guard = source.indexOf("process.env.VITEST && !process.env.DATA_DIR");
    const open = source.indexOf("new Database(DB_PATH)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(open);
  });
});
