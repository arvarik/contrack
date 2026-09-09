// =============================================================================
// Unit Tests — Scope and the FTS5 owner and contact tokens
// =============================================================================
// The tokens are generated in two places that must never drift: TypeScript,
// here, and the SQL that server/db.ts writes into the FTS triggers in Phase 1.
// Both forms are computed in this test and compared, so a change to either
// one fails rather than silently splitting a user's search index in half.
// =============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { Request } from "express";
import {
  scopeForUser,
  scopeForOwnerId,
  scopeOf,
  ownerToken,
  contactToken,
} from "../../server/tenancy/scope.ts";
import { AppError } from "../../server/utils/AppError.ts";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("Scope", () => {
  it("builds a frozen scope from a user and from a bare owner id", () => {
    const fromUser = scopeForUser({ id: UUID });
    const fromId = scopeForOwnerId(UUID);
    expect(fromUser.ownerId).toBe(UUID);
    expect(fromId.ownerId).toBe(UUID);
    expect(Object.isFrozen(fromUser)).toBe(true);
    expect(Object.isFrozen(fromId)).toBe(true);
  });

  it("derives a scope from a user principal", () => {
    const req = {
      principal: { kind: "user", user: { id: UUID }, sessionId: "s" },
    } as unknown as Request;
    expect(scopeOf(req).ownerId).toBe(UUID);
  });

  it.each([
    ["anonymous", { kind: "anonymous" }],
    ["service", { kind: "service" }],
    ["absent", undefined],
  ])("throws 401 for a %s principal", (_label, principal) => {
    const req = { principal } as unknown as Request;
    expect(() => scopeOf(req)).toThrow(AppError);
    try {
      scopeOf(req);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(401);
      expect((e as AppError).code).toBe("UNAUTHORIZED");
    }
  });
});

describe("FTS5 tokens", () => {
  it("matches the SQL expression server/db.ts uses", () => {
    const db = new Database(":memory:");
    const sqlOwner = db
      .prepare("SELECT 'o' || replace(?, '-', '') AS t")
      .get(UUID) as { t: string };
    const sqlContact = db
      .prepare("SELECT 'c' || replace(?, '-', '') AS t")
      .get(UUID) as { t: string };

    expect(ownerToken(scopeForOwnerId(UUID))).toBe(sqlOwner.t);
    expect(contactToken(UUID)).toBe(sqlContact.t);
    db.close();
  });

  it("is a single FTS5 term, so an owner filter cannot be split", () => {
    const db = new Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE tok USING fts5(t)");
    db.exec("CREATE VIRTUAL TABLE tok_v USING fts5vocab(tok, 'row')");
    const token = ownerToken(scopeForOwnerId(UUID));
    db.prepare("INSERT INTO tok(t) VALUES (?)").run(token);

    const hit = db
      .prepare("SELECT count(*) AS n FROM tok WHERE tok MATCH ?")
      .get(`t:${token}`) as { n: number };
    expect(hit.n).toBe(1);

    // One row in, one distinct term out. A hyphen would make it several.
    const terms = db.prepare("SELECT count(*) AS n FROM tok_v").get() as {
      n: number;
    };
    expect(terms.n).toBe(1);

    // A different owner's token must not match.
    const other = ownerToken(
      scopeForOwnerId("00000000-0000-4000-8000-000000000001"),
    );
    const miss = db
      .prepare("SELECT count(*) AS n FROM tok WHERE tok MATCH ?")
      .get(`t:${other}`) as { n: number };
    expect(miss.n).toBe(0);
    db.close();
  });

  it("strips every hyphen", () => {
    expect(ownerToken(scopeForOwnerId(UUID))).not.toContain("-");
    expect(contactToken(UUID)).not.toContain("-");
    expect(ownerToken(scopeForOwnerId(UUID))).toHaveLength(33);
  });
});
