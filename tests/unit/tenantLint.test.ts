// =============================================================================
// Unit Tests — tenant-lint scanner
// =============================================================================
// The scanner is what stops an unscoped query reaching production in Phase 2,
// so its own rules are pinned here. A scanner that silently stops flagging is
// worse than no scanner, because the report keeps printing a reassuring zero.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  scanSource,
  globToRegExp,
  ALLOWED_REASONS,
} from "../../scripts/tenant-lint.mjs";

const findings = (src: string) => scanSource(src, "test.ts");

describe("tenant-lint: flagging", () => {
  it("flags a SELECT over an owned table with no owner predicate", () => {
    const out = findings(`const q = "SELECT * FROM contacts WHERE id = ?";`);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("unscoped");
    expect(out[0].kind).toBe("sql:contacts");
  });

  it.each([
    ["UPDATE", `"UPDATE lists SET name = ?"`],
    ["DELETE FROM", `"DELETE FROM interactions WHERE id = ?"`],
    ["INSERT INTO", `"INSERT INTO action_items (id) VALUES (?)"`],
    ["JOIN", `"SELECT * FROM x JOIN dedupe_suggestions s ON s.id = x.id"`],
  ])("flags a bare %s", (_label, literal) => {
    expect(findings(`const q = ${literal};`)).toHaveLength(1);
  });

  it("flags a virtual table the same way", () => {
    const out = findings(`const q = "SELECT * FROM search_embeddings";`);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("sql:search_embeddings");
  });

  it("flags a Drizzle builder chain on an owned table", () => {
    const out = findings(`const rows = db.select().from(schema.contacts);`);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("drizzle:contacts");
  });

  it("reports the line the statement starts on", () => {
    const out = findings(
      ["// header", "", `const q = "SELECT * FROM contacts";`].join("\n"),
    );
    expect(out[0].line).toBe(3);
  });
});

describe("tenant-lint: passing", () => {
  it("accepts a statement that carries ownerId", () => {
    const src = `const q = "SELECT * FROM contacts WHERE id = ? AND ownerId = ?";`;
    expect(findings(src)).toEqual([]);
  });

  it("accepts an FTS statement that carries ownerTok", () => {
    const src = `const q = "SELECT * FROM contacts_fts WHERE contacts_fts MATCH 'ownerTok:' || ?";`;
    expect(findings(src)).toEqual([]);
  });

  it("ignores a table that is not owned", () => {
    expect(findings(`const q = "SELECT * FROM users WHERE id = ?";`)).toEqual(
      [],
    );
    expect(findings(`const q = "SELECT * FROM sessions";`)).toEqual([]);
  });

  it("ignores SQL that only appears in a comment", () => {
    const src = [
      `// SELECT * FROM contacts`,
      `/* DELETE FROM lists */`,
      `const x = 1;`,
    ].join("\n");
    expect(findings(src)).toEqual([]);
  });
});

describe("tenant-lint: allow comments", () => {
  it.each(ALLOWED_REASONS as string[])("honors the reason %s", (reason) => {
    const src = [
      `// tenant-lint: allow ${reason}`,
      `const q = "SELECT * FROM contacts";`,
    ].join("\n");
    expect(findings(src)).toEqual([]);
  });

  it("rejects an allow comment with an unknown reason", () => {
    const src = [
      `// tenant-lint: allow because I said so`,
      `const q = "SELECT * FROM contacts";`,
    ].join("\n");
    const out = findings(src);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("unknown-reason");
    expect(out[0].reason).toBe("because I said so");
  });

  it("does not let an allow comment leak onto a later statement", () => {
    const src = [
      `// tenant-lint: allow instance sweep`,
      `const a = "DELETE FROM ai_invocations WHERE createdAt < ?";`,
      `const b = "SELECT * FROM contacts";`,
      `const c = "SELECT * FROM lists";`,
    ].join("\n");
    const out = findings(src);
    expect(out.map((f) => f.kind)).toEqual(["sql:contacts", "sql:lists"]);
  });
});

describe("tenant-lint: glob matching for --strict", () => {
  it("matches a directory tree with **", () => {
    const re = globToRegExp("server/**");
    expect(re.test("server/services/contactService.ts")).toBe(true);
    expect(re.test("scripts/seed.ts")).toBe(false);
  });

  it("matches a single file", () => {
    const re = globToRegExp("server/services/listService.ts");
    expect(re.test("server/services/listService.ts")).toBe(true);
    expect(re.test("server/services/contactService.ts")).toBe(false);
  });

  it("does not let * cross a path separator", () => {
    const re = globToRegExp("server/*.ts");
    expect(re.test("server/db.ts")).toBe(true);
    expect(re.test("server/services/listService.ts")).toBe(false);
  });
});
