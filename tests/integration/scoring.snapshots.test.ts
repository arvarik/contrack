// =============================================================================
// Integration Tests — score snapshots for Pulse momentum & history
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  snapshotScores,
  ensureWeeklySnapshot,
} from "../../server/services/relationshipService.ts";
import { runDailyMaintenance } from "../../server/services/maintenanceService.ts";
import { isoWeekStart } from "../../shared/dates.ts";
import { makeTestApp } from "./helpers.ts";
import { createActor, type Actor, resetAccounts } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let A: Actor;
let B: Actor;
let seq = 0;

function addContact(
  ownerId: string,
  score: number = 75,
  overrides: Partial<{
    isArchived: number;
    isGhost: number;
    deletedAt: string | null;
    canonicalId: string | null;
  }> = {},
): string {
  const id = `snap-c-${++seq}`;
  // Tracked: only a tracked contact is scored, so only one is snapshotted.
  sqlite
    .prepare(
      `INSERT INTO contacts (id, ownerId, name, relationshipScore, isArchived, isGhost, deletedAt, canonicalId, isTracked)
       VALUES (?, ?, 'Contact', ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      id,
      ownerId,
      score,
      overrides.isArchived ?? 0,
      overrides.isGhost ?? 0,
      overrides.deletedAt ?? null,
      overrides.canonicalId ?? null,
    );
  return id;
}

beforeAll(async () => {
  app = makeTestApp();
  A = await createActor(app, { username: "snapa", email: "snapa@test.dev" });
  B = await createActor(app, { username: "snapb", email: "snapb@test.dev" });
});

afterAll(() => {
  resetAccounts();
  app.close();
});

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM score_snapshots;
    DELETE FROM contacts WHERE id LIKE 'snap-c-%';
  `);
});

describe("snapshotScores", () => {
  it("captures scores for eligible contacts of one owner only", () => {
    const cA1 = addContact(A.user.id, 80);
    const cA2 = addContact(A.user.id, 65);
    addContact(B.user.id, 90);

    // Ineligible contacts for A
    addContact(A.user.id, 50, { isArchived: 1 });
    addContact(A.user.id, 40, { isGhost: 1 });
    addContact(A.user.id, 30, { deletedAt: new Date().toISOString() });
    addContact(A.user.id, 20, { canonicalId: cA1 });

    const inserted = snapshotScores(A.user.id, "2026-09-14");
    expect(inserted).toBe(2);

    const rows = sqlite
      .prepare(
        `SELECT contactId, weekStart, score, ownerId FROM score_snapshots WHERE ownerId = ? ORDER BY contactId`,
      )
      .all(A.user.id) as {
      contactId: string;
      weekStart: string;
      score: number;
      ownerId: string;
    }[];

    expect(rows).toEqual([
      {
        contactId: cA1,
        weekStart: "2026-09-14",
        score: 80,
        ownerId: A.user.id,
      },
      {
        contactId: cA2,
        weekStart: "2026-09-14",
        score: 65,
        ownerId: A.user.id,
      },
    ]);

    // B has no snapshots yet
    const bCount = sqlite
      .prepare(`SELECT COUNT(*) as n FROM score_snapshots WHERE ownerId = ?`)
      .get(B.user.id) as { n: number };
    expect(bCount.n).toBe(0);
  });

  it("ignores duplicate snapshots in the same week (INSERT OR IGNORE)", () => {
    const c1 = addContact(A.user.id, 80);
    expect(snapshotScores(A.user.id, "2026-09-14")).toBe(1);

    // Update score on contact
    sqlite
      .prepare("UPDATE contacts SET relationshipScore = 95 WHERE id = ?")
      .run(c1);

    // Re-running snapshot in the same week inserts 0 rows and does not overwrite
    expect(snapshotScores(A.user.id, "2026-09-14")).toBe(0);

    const row = sqlite
      .prepare(
        "SELECT score FROM score_snapshots WHERE contactId = ? AND weekStart = ?",
      )
      .get(c1, "2026-09-14") as { score: number };
    expect(row.score).toBe(80);

    // But another week CAN be inserted
    expect(snapshotScores(A.user.id, "2026-09-21")).toBe(1);
    const row2 = sqlite
      .prepare(
        "SELECT score FROM score_snapshots WHERE contactId = ? AND weekStart = ?",
      )
      .get(c1, "2026-09-21") as { score: number };
    expect(row2.score).toBe(95);
  });

  it("cascades when contact is deleted", () => {
    const c1 = addContact(A.user.id, 80);
    snapshotScores(A.user.id, "2026-09-14");

    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(c1);

    const count = sqlite
      .prepare("SELECT COUNT(*) as n FROM score_snapshots WHERE contactId = ?")
      .get(c1) as { n: number };
    expect(count.n).toBe(0);
  });
});

describe("ensureWeeklySnapshot", () => {
  it("creates snapshots for current week for all owners with contacts", () => {
    addContact(A.user.id, 70);
    addContact(B.user.id, 85);

    const now = new Date(2026, 8, 17); // Thursday 2026-09-17
    const expectedWeek = isoWeekStart(now); // 2026-09-14
    ensureWeeklySnapshot(now);

    const aSnap = sqlite
      .prepare(
        "SELECT COUNT(*) as n FROM score_snapshots WHERE ownerId = ? AND weekStart = ?",
      )
      .get(A.user.id, expectedWeek) as { n: number };
    expect(aSnap.n).toBe(1);

    const bSnap = sqlite
      .prepare(
        "SELECT COUNT(*) as n FROM score_snapshots WHERE ownerId = ? AND weekStart = ?",
      )
      .get(B.user.id, expectedWeek) as { n: number };
    expect(bSnap.n).toBe(1);
  });
});

describe("maintenance pruning", () => {
  it("prunes score snapshots older than 26 weeks", () => {
    const c1 = addContact(A.user.id, 70);

    // Week 30 weeks ago: should be pruned
    const oldDate = new Date(Date.now() - 30 * 7 * 86_400_000);
    const oldWeek = isoWeekStart(oldDate);

    // Week 10 weeks ago: should be kept
    const recentDate = new Date(Date.now() - 10 * 7 * 86_400_000);
    const recentWeek = isoWeekStart(recentDate);

    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(A.user.id, c1, oldWeek, 60);

    sqlite
      .prepare(
        `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
      )
      .run(A.user.id, c1, recentWeek, 70);

    const counts = runDailyMaintenance();
    expect(counts.prunedScoreSnapshots).toBe(1);

    const remaining = sqlite
      .prepare("SELECT weekStart FROM score_snapshots WHERE contactId = ?")
      .all(c1) as { weekStart: string }[];
    expect(remaining).toEqual([{ weekStart: recentWeek }]);
  });
});
