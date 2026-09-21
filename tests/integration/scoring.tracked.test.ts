// =============================================================================
// Integration Tests — only a tracked contact is scored
// =============================================================================
// The score is an opt-in. `contacts.isTracked` gates the two sweeps, the
// single-contact readers, the inline scorer behind the tracking routes and
// the weekly snapshot. An untracked contact's stored score is a placeholder
// that nothing writes and nothing shows.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  relationshipService,
  snapshotScores,
  INLINE_SCORE_LIMIT,
} from "../../server/services/relationshipService.ts";
import { isoWeekStart } from "../../shared/dates.ts";
import { makeTestApp } from "./helpers.ts";
import { createActor, type Actor, resetAccounts } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let A: Actor;
let B: Actor;
let seq = 0;

/** A score the formula never produces for these rows, so a write shows. */
const SENTINEL = 7;
const LAST_CONTACTED = new Date(Date.now() - 10 * 86_400_000).toISOString();

function addContact(
  owner: string,
  overrides: Partial<{ tracked: number; lastContactedAt: string | null }> = {},
): string {
  const id = `trk-c-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO contacts
         (id, ownerId, name, cadenceDays, lastContactedAt, isTracked, relationshipScore)
       VALUES (?, ?, ?, 90, ?, ?, ?)`,
    )
    .run(
      id,
      owner,
      `Tracked Person ${seq}`,
      overrides.lastContactedAt === undefined
        ? LAST_CONTACTED
        : overrides.lastContactedAt,
      overrides.tracked ?? 1,
      SENTINEL,
    );
  return id;
}

interface Row {
  relationshipScore: number;
  scoreDirty: number;
  isTracked: number;
  trackedAt: string | null;
  updatedAt: string;
}

function row(id: string): Row {
  return sqlite
    .prepare(
      `SELECT relationshipScore, scoreDirty, isTracked, trackedAt, updatedAt
         FROM contacts WHERE id = ?`,
    )
    .get(id) as Row;
}

beforeAll(async () => {
  app = makeTestApp();
  A = await createActor(app, { username: "trka", email: "trka@test.dev" });
  B = await createActor(app, { username: "trkb", email: "trkb@test.dev" });
});

afterAll(() => {
  resetAccounts();
  app.close();
});

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM score_snapshots;
    DELETE FROM contacts WHERE id LIKE 'trk-c-%';
  `);
});

describe("the sweeps", () => {
  it("leave an untracked contact alone, and clear its mark once", async () => {
    const id = addContact(A.user.id, { tracked: 0 });
    expect(row(id).scoreDirty).toBe(1);

    await relationshipService.recomputeStale();
    expect(row(id).relationshipScore).toBe(SENTINEL);
    expect(row(id).scoreDirty).toBe(0);

    // The full sweep reads everything eligible, and this row is not.
    sqlite.prepare(`UPDATE contacts SET scoreDirty = 1 WHERE id = ?`).run(id);
    await relationshipService.recomputeAll();
    expect(row(id).relationshipScore).toBe(SENTINEL);
  });

  it("score a tracked contact in the incremental sweep", async () => {
    const id = addContact(A.user.id);
    await relationshipService.recomputeStale();
    expect(row(id).relationshipScore).not.toBe(SENTINEL);
    expect(row(id).scoreDirty).toBe(0);
  });

  it("stop scoring a contact once it is untracked, without a write", async () => {
    const id = addContact(A.user.id);
    await relationshipService.recomputeStale();
    const scored = row(id).relationshipScore;
    expect(scored).not.toBe(SENTINEL);

    // The flip is an edit, so the trigger marks the row.
    sqlite.prepare(`UPDATE contacts SET isTracked = 0 WHERE id = ?`).run(id);
    expect(row(id).scoreDirty).toBe(1);
    expect(row(id).trackedAt).toBeNull();

    await relationshipService.recomputeStale();
    expect(row(id).scoreDirty).toBe(0);
    expect(row(id).relationshipScore).toBe(scored);
  });
});

describe("the single-contact readers", () => {
  it("answer null for an untracked contact and write nothing", () => {
    const id = addContact(A.user.id, { tracked: 0 });
    const before = row(id);

    expect(relationshipService.explainScore(id)).toBeNull();
    expect(relationshipService.computeScore(id)).toBeNull();

    expect(row(id)).toEqual(before);
  });

  it("answer for a tracked contact, and write the score back", () => {
    const id = addContact(A.user.id);
    const breakdown = relationshipService.explainScore(id);
    expect(breakdown).not.toBeNull();
    expect(typeof breakdown?.score).toBe("number");
    expect(row(id).relationshipScore).toBe(breakdown?.score);
    expect(row(id).scoreDirty).toBe(0);

    expect(relationshipService.computeScore(id)).toBe(breakdown?.score);
  });
});

describe("scoreContacts", () => {
  it("scores the owner's tracked ids now, and nobody else", async () => {
    const mine = addContact(A.user.id);
    const untracked = addContact(A.user.id, { tracked: 0 });
    const theirs = addContact(B.user.id);

    const scored = await relationshipService.scoreContacts(A.user.id, [
      mine,
      untracked,
      theirs,
    ]);

    expect(scored).toBe(1);
    expect(row(mine).relationshipScore).not.toBe(SENTINEL);
    expect(row(mine).scoreDirty).toBe(0);
    expect(row(untracked).relationshipScore).toBe(SENTINEL);
    expect(row(theirs).relationshipScore).toBe(SENTINEL);
  });

  it("does nothing above the inline limit, and leaves the rows marked", async () => {
    const id = addContact(A.user.id);
    const ids = Array.from({ length: INLINE_SCORE_LIMIT + 1 }, (_, i) =>
      i === 0 ? id : `trk-c-missing-${i}`,
    );
    expect(await relationshipService.scoreContacts(A.user.id, ids)).toBe(0);
    expect(row(id).relationshipScore).toBe(SENTINEL);
    expect(row(id).scoreDirty).toBe(1);
  });

  it("works through a batch boundary", async () => {
    const ids = Array.from({ length: 205 }, () => addContact(A.user.id));
    expect(await relationshipService.scoreContacts(A.user.id, ids)).toBe(205);
    const left = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE ownerId = ? AND id LIKE 'trk-c-%' AND relationshipScore = ?`,
      )
      .get(A.user.id, SENTINEL) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("snapshots", () => {
  it("skip untracked rows", () => {
    const tracked = addContact(A.user.id);
    addContact(A.user.id, { tracked: 0 });
    const week = isoWeekStart(new Date());

    expect(snapshotScores(A.user.id, week)).toBe(1);
    const rows = sqlite
      .prepare(`SELECT contactId FROM score_snapshots WHERE ownerId = ?`)
      .all(A.user.id) as { contactId: string }[];
    expect(rows.map((r) => r.contactId)).toEqual([tracked]);
  });
});
