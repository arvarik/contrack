// =============================================================================
// Integration Tests — incremental relationship scoring (story S10)
// =============================================================================
// Two claims are under test here and they pull in opposite directions.
//
// The first is that the hourly sweep does work in proportion to what changed.
// That is easy to assert and easy to get wrong in a way no assertion catches:
// a sweep that skips everything also does work in proportion to what changed.
// So every "marks it" case below is paired with a "and the sweep then scores
// it" case, and the quiet case asserts the count is zero rather than small.
//
// The second is that scoring is not an edit. Before this story the sweep wrote
// `relationshipScore` on every contact every hour, which fired the broad
// `contacts_auto_updated_at` trigger and stamped `updatedAt` on the whole
// corpus. That made `updatedAt` mean "the last sweep", told the dedupe engine
// every contact needed re-embedding, and made the dirty flag impossible.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sqlite, SCORE_COLUMNS, contactEditColumns } from "../../server/db.ts";
import { relationshipService } from "../../server/services/relationshipService.ts";
import { makeTestApp } from "./helpers.ts";
import { createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let A: Actor;
let B: Actor;

/** A score no computation produces, so "was this row written" is answerable. */
const UNSCORED = -1;

/**
 * How long ago every contact here was last contacted.
 *
 * Not "now", and the reason is a cliff in the formula rather than a
 * preference. `recencyScore` returns 100 when `daysSince <= 0` and falls
 * straight to 91.68 at any positive value, so a contact stamped with the
 * current instant scores one of two numbers eight points apart depending on
 * whether the reader lands in the same millisecond as the writer. Two scores
 * of the same contact taken microseconds apart then disagree, which made
 * `explainScore` look inconsistent with the sweep about one run in twenty.
 */
const LAST_CONTACTED = new Date(Date.now() - 5 * 86_400_000).toISOString();

let seq = 0;

function addContact(
  owner: string,
  overrides: Partial<{
    name: string;
    cadenceDays: number;
    lastContactedAt: string | null;
    isArchived: number;
    isGhost: number;
  }> = {},
): string {
  const id = `sc-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO contacts
         (id, ownerId, name, cadenceDays, lastContactedAt, isGhost, isArchived,
          relationshipScore, addedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      owner,
      overrides.name ?? `Scored Person ${seq}`,
      overrides.cadenceDays ?? 90,
      overrides.lastContactedAt ?? LAST_CONTACTED,
      overrides.isGhost ?? 0,
      overrides.isArchived ?? 0,
      UNSCORED,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  return id;
}

function addInteraction(owner: string, contactId: string): string {
  const id = `si-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO interactions (id, ownerId, contactId, type, title, date, content)
       VALUES (?, ?, ?, 'email', 'Subject', date('now'), 'A few words about it.')`,
    )
    .run(id, owner, contactId);
  return id;
}

function addActionItem(owner: string, contactId: string): string {
  const id = `sa-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO action_items (id, ownerId, contactId, title, dueAt)
       VALUES (?, ?, ?, 'Follow up', date('now', '+7 days'))`,
    )
    .run(id, owner, contactId);
  return id;
}

const readRow = (id: string) =>
  sqlite
    .prepare(
      "SELECT scoreDirty, relationshipScore, updatedAt FROM contacts WHERE id = ?",
    )
    .get(id) as {
    scoreDirty: number;
    relationshipScore: number;
    updatedAt: string;
  };

const dirtyCount = () =>
  (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM contacts WHERE scoreDirty = 1")
      .get() as { n: number }
  ).n;

/** Put every contact back to clean and unscored, so each test starts level. */
function settle(): void {
  sqlite
    .prepare("UPDATE contacts SET relationshipScore = ?, scoreDirty = 0")
    .run(UNSCORED);
}

beforeAll(async () => {
  app = makeTestApp();
  A = await createActor(app, { username: "scorea", email: "scorea@test.dev" });
  B = await createActor(app, { username: "scoreb", email: "scoreb@test.dev" });
});

afterAll(() => {
  app.close();
});

// ---------------------------------------------------------------------------
// The trigger's column list
// ---------------------------------------------------------------------------

describe("the updatedAt trigger fires on edits and nothing else", () => {
  it("lists exactly the table's columns minus the score columns", () => {
    const ddl = (
      sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        )
        .get("contacts_auto_updated_at") as { sql: string }
    ).sql;

    const listed = /AFTER UPDATE OF ([^]*?) ON contacts/i
      .exec(ddl)![1]
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""));

    const all = (
      sqlite.pragma("table_info(contacts)") as { name: string }[]
    ).map((c) => c.name);

    expect(listed.slice().sort()).toEqual(
      all.filter((c) => !SCORE_COLUMNS.includes(c as never)).sort(),
    );
    // Both score columns exist, so the filter above removed something.
    for (const column of SCORE_COLUMNS) expect(all).toContain(column);
    expect(contactEditColumns(sqlite).slice().sort()).toEqual(
      listed.slice().sort(),
    );
  });

  it("does not stamp updatedAt when only the score is written", async () => {
    const id = addContact(A.user.id);
    const before = readRow(id).updatedAt;

    // datetime('now') has one-second resolution, so a stamp inside the same
    // second would be invisible. Write a value the clock cannot reach.
    sqlite
      .prepare(
        "UPDATE contacts SET updatedAt = '2020-01-01T00:00:00.000Z' WHERE id = ?",
      )
      .run(id);
    expect(readRow(id).updatedAt).toBe("2020-01-01T00:00:00.000Z");

    sqlite
      .prepare(
        "UPDATE contacts SET relationshipScore = 77, scoreDirty = 0 WHERE id = ?",
      )
      .run(id);

    expect(readRow(id).updatedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(readRow(id).relationshipScore).toBe(77);
    expect(before).not.toBe("");
  });

  it("stamps updatedAt when a field of the contact is written", () => {
    const id = addContact(A.user.id);
    sqlite
      .prepare(
        "UPDATE contacts SET updatedAt = '2020-01-01T00:00:00.000Z' WHERE id = ?",
      )
      .run(id);

    sqlite
      .prepare("UPDATE contacts SET company = 'Globex' WHERE id = ?")
      .run(id);

    expect(readRow(id).updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("leaves the whole corpus untouched across a full sweep", async () => {
    const ids = [
      addContact(A.user.id),
      addContact(A.user.id),
      addContact(B.user.id),
    ];
    settle();

    // A snapshot rather than a stamped sentinel: writing one value over every
    // row is itself an edit, and a row that already held that value would come
    // back stamped by the trigger under test.
    const snapshot = new Map(
      (
        sqlite.prepare("SELECT id, updatedAt FROM contacts").all() as {
          id: string;
          updatedAt: string;
        }[]
      ).map((r) => [r.id, r.updatedAt]),
    );
    expect(snapshot.size).toBeGreaterThan(3);

    await relationshipService.recomputeAll();

    const moved = (
      sqlite.prepare("SELECT id, updatedAt FROM contacts").all() as {
        id: string;
        updatedAt: string;
      }[]
    ).filter((r) => snapshot.get(r.id) !== r.updatedAt);
    expect(moved).toEqual([]);

    // And the sweep really did write scores, so the empty list above means
    // "untouched" rather than "did nothing".
    for (const id of ids)
      expect(readRow(id).relationshipScore).not.toBe(UNSCORED);
  });
});

// ---------------------------------------------------------------------------
// What marks a contact
// ---------------------------------------------------------------------------

describe("what marks a contact for re-scoring", () => {
  it("marks a contact the moment it is created", () => {
    const id = addContact(A.user.id);
    expect(readRow(id).scoreDirty).toBe(1);
  });

  it("marks a contact when one of its own fields changes", () => {
    const id = addContact(A.user.id);
    settle();
    sqlite.prepare("UPDATE contacts SET cadenceDays = 30 WHERE id = ?").run(id);
    expect(readRow(id).scoreDirty).toBe(1);
  });

  it("does not mark a contact when only the score is written", () => {
    const id = addContact(A.user.id);
    settle();
    sqlite
      .prepare("UPDATE contacts SET relationshipScore = 61 WHERE id = ?")
      .run(id);
    expect(readRow(id).scoreDirty).toBe(0);
  });

  it("marks a contact when an interaction is written, changed or removed", () => {
    const id = addContact(A.user.id);
    settle();

    const interactionId = addInteraction(A.user.id, id);
    expect(readRow(id).scoreDirty).toBe(1);

    settle();
    sqlite
      .prepare("UPDATE interactions SET content = 'More words.' WHERE id = ?")
      .run(interactionId);
    expect(readRow(id).scoreDirty).toBe(1);

    settle();
    sqlite.prepare("DELETE FROM interactions WHERE id = ?").run(interactionId);
    expect(readRow(id).scoreDirty).toBe(1);
  });

  it("marks both contacts when an interaction is re-parented", () => {
    const from = addContact(A.user.id);
    const to = addContact(A.user.id);
    const interactionId = addInteraction(A.user.id, from);
    settle();

    sqlite
      .prepare("UPDATE interactions SET contactId = ? WHERE id = ?")
      .run(to, interactionId);

    expect(readRow(from).scoreDirty).toBe(1);
    expect(readRow(to).scoreDirty).toBe(1);
  });

  it("marks a contact when an action item is written, changed or removed", () => {
    const id = addContact(A.user.id);
    settle();

    const itemId = addActionItem(A.user.id, id);
    expect(readRow(id).scoreDirty).toBe(1);

    settle();
    sqlite
      .prepare("UPDATE action_items SET title = 'Follow up again' WHERE id = ?")
      .run(itemId);
    expect(readRow(id).scoreDirty).toBe(1);

    settle();
    sqlite.prepare("DELETE FROM action_items WHERE id = ?").run(itemId);
    expect(readRow(id).scoreDirty).toBe(1);
  });

  it("costs one row write when a marked contact is marked again", () => {
    const id = addContact(A.user.id);
    settle();
    addInteraction(A.user.id, id);

    const stamped = sqlite
      .prepare(
        "UPDATE contacts SET scoreDirty = 1 WHERE id = ? AND scoreDirty = 0",
      )
      .run(id);
    expect(stamped.changes).toBe(0);
    expect(readRow(id).scoreDirty).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The sweeps
// ---------------------------------------------------------------------------

describe("the incremental sweep", () => {
  it("does nothing at all on a quiet instance", async () => {
    settle();
    const result = await relationshipService.recomputeStale();
    expect(result).toMatchObject({
      owners: 0,
      scored: 0,
      cleared: 0,
      skipped: 0,
    });
  });

  it("scores only what changed, and clears it", async () => {
    const stale = addContact(A.user.id);
    const quiet = addContact(A.user.id);
    settle();
    addInteraction(A.user.id, stale);

    const result = await relationshipService.recomputeStale();

    expect(result.scored).toBe(1);
    expect(result.owners).toBe(1);
    expect(readRow(stale).relationshipScore).not.toBe(UNSCORED);
    expect(readRow(stale).scoreDirty).toBe(0);
    expect(readRow(quiet).relationshipScore).toBe(UNSCORED);
    expect(dirtyCount()).toBe(0);
  });

  it("clears an archived or ghost contact instead of scoring it, once", async () => {
    const archived = addContact(A.user.id, { isArchived: 1 });
    const ghost = addContact(A.user.id, { isGhost: 1 });
    settle();
    sqlite
      .prepare("UPDATE contacts SET scoreDirty = 1 WHERE id IN (?, ?)")
      .run(archived, ghost);

    const first = await relationshipService.recomputeStale();
    expect(first.cleared).toBe(2);
    expect(first.scored).toBe(0);
    expect(readRow(archived).relationshipScore).toBe(UNSCORED);
    expect(readRow(ghost).relationshipScore).toBe(UNSCORED);

    // And they are gone from the queue rather than found again every hour.
    const second = await relationshipService.recomputeStale();
    expect(second).toMatchObject({ owners: 0, scored: 0, cleared: 0 });
  });

  it("keeps each account's work to that account", async () => {
    const mine = addContact(A.user.id);
    const theirs = addContact(B.user.id);
    settle();
    addInteraction(A.user.id, mine);

    const result = await relationshipService.recomputeStale();

    expect(result.owners).toBe(1);
    expect(readRow(mine).relationshipScore).not.toBe(UNSCORED);
    expect(readRow(theirs).relationshipScore).toBe(UNSCORED);
  });

  it("takes turns between accounts rather than draining one first", async () => {
    // Six hundred each, so both need several rounds at a batch of 200. The
    // assertion is deliberately not about which account goes first: a sweep
    // that drained one account and then the other would pass an "A finished
    // early" check whenever A happened to be first in the queue.
    const PER_OWNER = 600;
    for (let i = 0; i < PER_OWNER; i++) {
      addContact(A.user.id);
      addContact(B.user.id);
    }
    settle();
    sqlite.prepare("UPDATE contacts SET scoreDirty = 1").run();

    const scoredFor = (ownerId: string) =>
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ? AND relationshipScore <> ?",
          )
          .get(ownerId, UNSCORED) as { n: number }
      ).n;

    const sweep = relationshipService.recomputeStale();

    // The sweep yields to the event loop between rounds, so a macrotask
    // scheduled now runs after the first round of batches.
    const sample = await new Promise<{ a: number; b: number }>((resolve) =>
      setImmediate(() =>
        resolve({ a: scoredFor(A.user.id), b: scoredFor(B.user.id) }),
      ),
    );

    const result = await sweep;
    expect(result.owners).toBe(2);

    // Both accounts were served in the first round, and neither was finished.
    // One account at a time would have left the other at zero.
    expect(sample.a).toBeGreaterThan(0);
    expect(sample.b).toBeGreaterThan(0);
    expect(sample.a).toBeLessThan(PER_OWNER);
    expect(sample.b).toBeLessThan(PER_OWNER);
    expect(dirtyCount()).toBe(0);
  });
});

describe("the full sweep", () => {
  it("scores every eligible contact whether or not it changed", async () => {
    const a = addContact(A.user.id);
    const b = addContact(B.user.id);
    const archived = addContact(A.user.id, { isArchived: 1 });
    settle();

    const result = await relationshipService.recomputeAll();

    expect(readRow(a).relationshipScore).not.toBe(UNSCORED);
    expect(readRow(b).relationshipScore).not.toBe(UNSCORED);
    expect(readRow(archived).relationshipScore).toBe(UNSCORED);
    expect(result.owners).toBe(2);
    expect(result.scored).toBeGreaterThanOrEqual(2);
    expect(dirtyCount()).toBe(0);
  });

  it("still answers with a score a person can read", async () => {
    const id = addContact(A.user.id, { cadenceDays: 30 });
    addInteraction(A.user.id, id);
    await relationshipService.recomputeStale();

    const score = readRow(id).relationshipScore;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    // The explanation and the badge beside it have to be the same number.
    // They are computed at two different instants, so this only holds while
    // the formula is continuous over that gap — see LAST_CONTACTED.
    const breakdown = relationshipService.explainScore(id);
    expect(breakdown?.score).toBe(score);
    // Explaining writes the fresh score back, and that is not an edit either.
    expect(readRow(id).scoreDirty).toBe(0);
  });
});
