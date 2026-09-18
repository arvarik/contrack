// =============================================================================
// Integration Tests — the daily maintenance sweep
// =============================================================================
// Five tables accumulate rows that no request removes. Before Phase 3 there
// was no daily job at all: `cleanupOldInvocations` ran once at boot and the
// session sweep was boot-only, so an instance left running for a year swept
// twice.
//
// The rows are aged by writing an old timestamp rather than by moving the
// clock. Every cut-off is `datetime('now', '-N days')`, evaluated by SQLite,
// so a fake clock in the test process would not reach it. An aged row and an
// advanced clock are the same comparison from the statement's point of view,
// and this way the assertion is about the SQL that ships.
//
// The interval itself is tested with fake timers, because "it runs daily" is
// a claim about scheduling that no amount of calling the function proves.
// =============================================================================

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import crypto from "node:crypto";
import { sqlite } from "../../server/db.ts";
import { resetAccounts, localOwnerId } from "./tenancy/helpers.ts";
import {
  runDailyMaintenance,
  startDailyMaintenance,
  AUDIT_RETENTION_DAYS,
  REVOKED_TOKEN_RETENTION_DAYS,
  DEAD_INVITATION_RETENTION_DAYS,
  IMPORT_RETENTION_DAYS,
  AUTH_LINK_RETENTION_DAYS,
} from "../../server/services/maintenanceService.ts";

/** A timestamp `days` in the past, in the format the columns store. */
function daysAgo(days: number): string {
  return shift(`-${days} days`);
}

/** A timestamp `days` in the future. */
function daysAhead(days: number): string {
  return shift(`+${days} days`);
}

function shift(modifier: string): string {
  return (
    sqlite.prepare(`SELECT datetime('now', ?) AS t`).get(modifier) as {
      t: string;
    }
  ).t;
}

function clearAll(): void {
  sqlite.exec(`
    DELETE FROM audit_log;
    DELETE FROM invitations;
    DELETE FROM api_tokens;
    DELETE FROM sessions;
    DELETE FROM auth_challenges;
    DELETE FROM auth_links;
    DELETE FROM passkeys;
    DELETE FROM ai_invocations;
    DELETE FROM imports;
    DELETE FROM score_snapshots;
  `);
}

function insertImport(
  id: string,
  status: string,
  updatedAt: string,
  owner: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO imports (id, ownerId, status, total, updatedAt) VALUES (?, ?, ?, 1, ?)`,
    )
    .run(id, owner, status, updatedAt);
  sqlite
    .prepare(
      `INSERT INTO import_rows (importId, rowIndex, status, name) VALUES (?, 0, 'failed', 'x')`,
    )
    .run(id);
}

function insertAudit(id: string, createdAt: string): void {
  sqlite
    .prepare(
      `INSERT INTO audit_log (id, action, createdAt) VALUES (?, 'auth.logout', ?)`,
    )
    .run(id, createdAt);
}

function insertSession(id: string, expiresAt: string, userId: string): void {
  sqlite
    .prepare(`INSERT INTO sessions (id, userId, expiresAt) VALUES (?, ?, ?)`)
    .run(id, userId, expiresAt);
}

function insertToken(
  id: string,
  userId: string,
  fields: { revokedAt?: string | null; expiresAt?: string | null } = {},
): void {
  sqlite
    .prepare(
      `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, revokedAt, expiresAt)
       VALUES (?, ?, 'A script', ?, 'ctk_aaaaaaa', ?, ?)`,
    )
    .run(
      id,
      userId,
      crypto.randomUUID(),
      fields.revokedAt ?? null,
      fields.expiresAt ?? null,
    );
}

function insertChallenge(id: string, expiresAt: string): void {
  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, challenge, expiresAt)
       VALUES (?, 'login', 'challenge_payload', ?)`,
    )
    .run(id, expiresAt);
}

function insertAuthLink(
  id: string,
  userId: string,
  fields: {
    createdAt?: string;
    expiresAt: string;
    usedAt?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO auth_links (id, kind, userId, tokenHash, createdAt, expiresAt, usedAt)
       VALUES (?, 'reset', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      crypto.randomUUID(),
      fields.createdAt ?? daysAgo(1),
      fields.expiresAt,
      fields.usedAt ?? null,
    );
}

function insertInvitation(
  id: string,
  userId: string,
  fields: {
    createdAt: string;
    expiresAt: string;
    revokedAt?: string | null;
    acceptedAt?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO invitations (id, role, tokenHash, invitedBy, createdAt, expiresAt, revokedAt, acceptedAt)
       VALUES (?, 'member', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      crypto.randomUUID(),
      userId,
      fields.createdAt,
      fields.expiresAt,
      fields.revokedAt ?? null,
      fields.acceptedAt ?? null,
    );
}

function insertInvocation(id: string, createdAt: string, owner: string): void {
  sqlite
    .prepare(
      `INSERT INTO ai_invocations
         (id, operation, model, tokenCount, latencyMs, cached, createdAt, ownerId)
       VALUES (?, 'searchExpansion', 'mock', 10, 1, 0, ?, ?)`,
    )
    .run(id, createdAt, owner);
}

function insertScoreSnapshot(
  ownerId: string,
  contactId: string,
  weekStart: string,
  score = 50,
): void {
  sqlite
    .prepare(
      `INSERT INTO score_snapshots (ownerId, contactId, weekStart, score) VALUES (?, ?, ?, ?)`,
    )
    .run(ownerId, contactId, weekStart, score);
}

function ids(table: string): string[] {
  return (
    sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as {
      id: string;
    }[]
  ).map((r) => r.id);
}

let owner: string;

beforeEach(() => {
  resetAccounts();
  clearAll();
  owner = localOwnerId();
  // tests/integration-setup.ts sets this for every integration file. A test
  // that needs the sweep to run has to clear it itself: inheriting the
  // deletion from another test's teardown made the schedule test pass only
  // when something ran before it, and fail under any filter or reordering.
  delete process.env.DISABLE_BACKGROUND_JOBS;
});

afterEach(() => {
  vi.useRealTimers();
  process.env.DISABLE_BACKGROUND_JOBS = "true";
});

afterAll(() => {
  resetAccounts();
  clearAll();
});

describe("the daily sweep", () => {
  it("removes a finished import past its retention, with its rows, and keeps the rest", () => {
    insertImport(
      "old-complete",
      "complete",
      daysAgo(IMPORT_RETENTION_DAYS + 1),
      owner,
    );
    insertImport(
      "old-failed",
      "failed",
      daysAgo(IMPORT_RETENTION_DAYS + 1),
      owner,
    );
    insertImport(
      "recent",
      "complete",
      daysAgo(IMPORT_RETENTION_DAYS - 1),
      owner,
    );
    // A running record is never swept, however old. The next read of it is
    // what settles it, and a sweep that removed it would take the failed
    // rows somebody may still want to retry.
    insertImport(
      "old-imported",
      "imported",
      daysAgo(IMPORT_RETENTION_DAYS + 1),
      owner,
    );

    const counts = runDailyMaintenance();

    expect(counts.oldImports).toBe(2);
    expect(ids("imports")).toEqual(["old-imported", "recent"]);
    const rows = sqlite
      .prepare("SELECT importId FROM import_rows ORDER BY importId")
      .all() as { importId: string }[];
    expect(rows.map((r) => r.importId)).toEqual(["old-imported", "recent"]);
  });

  it("removes an audit row past its retention and keeps the rest", () => {
    insertAudit("old", daysAgo(AUDIT_RETENTION_DAYS + 1));
    insertAudit("edge", daysAgo(AUDIT_RETENTION_DAYS - 1));
    insertAudit("new", daysAgo(0));

    const counts = runDailyMaintenance();
    expect(counts.auditRows).toBe(1);
    expect(ids("audit_log")).toEqual(["edge", "new"]);
  });

  it("removes a session whose expiry has passed", () => {
    insertSession("expired", daysAgo(1), owner);
    insertSession("live", daysAhead(30), owner);

    const counts = runDailyMaintenance();
    expect(counts.expiredSessions).toBe(1);
    expect(ids("sessions")).toEqual(["live"]);
  });

  it("removes an auth challenge whose expiry has passed", () => {
    insertChallenge("expired", daysAgo(1));
    insertChallenge("live", daysAhead(1));

    const counts = runDailyMaintenance();
    expect(counts.expiredChallenges).toBe(1);
    expect(ids("auth_challenges")).toEqual(["live"]);
  });

  it("removes auth links used or expired more than 30 days ago", () => {
    // Used 31 days ago -> removed
    insertAuthLink("used-old", owner, {
      expiresAt: daysAhead(1),
      usedAt: daysAgo(AUTH_LINK_RETENTION_DAYS + 1),
    });
    // Used yesterday -> kept
    insertAuthLink("used-recent", owner, {
      expiresAt: daysAhead(1),
      usedAt: daysAgo(1),
    });
    // Expired 31 days ago (unused) -> removed
    insertAuthLink("expired-old", owner, {
      expiresAt: daysAgo(AUTH_LINK_RETENTION_DAYS + 1),
      usedAt: null,
    });
    // Expired yesterday (unused) -> kept
    insertAuthLink("expired-recent", owner, {
      expiresAt: daysAgo(1),
      usedAt: null,
    });
    // Still valid and unused -> kept
    insertAuthLink("live", owner, {
      expiresAt: daysAhead(1),
      usedAt: null,
    });

    const counts = runDailyMaintenance();
    expect(counts.agedAuthLinks).toBe(2);
    expect(ids("auth_links")).toEqual([
      "expired-recent",
      "live",
      "used-recent",
    ]);
  });

  it("removes one that expired earlier today, in the format a sign-in writes", () => {
    // `createSession` writes `new Date(...).toISOString()`, not
    // `CURRENT_TIMESTAMP`. SQLite compares TEXT byte by byte, and the two
    // formats differ first at the `T`, which sorts after a space, so a
    // session that expired an hour ago looked as though it had not. Every
    // other fixture here is seeded in SQLite's format and cannot see that.
    insertSession(
      "iso-expired",
      new Date(Date.now() - 3600_000).toISOString(),
      owner,
    );
    insertSession(
      "iso-live",
      new Date(Date.now() + 3600_000).toISOString(),
      owner,
    );

    const counts = runDailyMaintenance();
    expect(counts.expiredSessions).toBe(1);
    expect(ids("sessions")).toEqual(["iso-live"]);
  });

  it("removes an invitation that expired earlier today, in the same format", () => {
    // `createInvitation` writes an ISO string too.
    insertInvitation("iso-dead", owner, {
      createdAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS + 1),
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    insertInvitation("iso-alive", owner, {
      createdAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS + 1),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const counts = runDailyMaintenance();
    expect(counts.deadInvitations).toBe(1);
    expect(ids("invitations")).toEqual(["iso-alive"]);
  });

  it("ages out a revoked token and keeps an expired one", () => {
    insertToken("aged", owner, {
      revokedAt: daysAgo(REVOKED_TOKEN_RETENTION_DAYS + 1),
    });
    insertToken("just-revoked", owner, { revokedAt: daysAgo(1) });
    // An expired token stays. Its row is where somebody looks to find out why
    // their script stopped working, and the answer is on it.
    insertToken("expired", owner, { expiresAt: daysAgo(200) });
    insertToken("live", owner, {});

    const counts = runDailyMaintenance();
    expect(counts.agedTokens).toBe(1);
    expect(ids("api_tokens")).toEqual(["expired", "just-revoked", "live"]);
  });

  it("removes an invitation that died a month ago and keeps the rest", () => {
    const old = daysAgo(DEAD_INVITATION_RETENTION_DAYS + 1);
    insertInvitation("revoked-old", owner, {
      createdAt: old,
      expiresAt: daysAhead(1),
      revokedAt: old,
    });
    insertInvitation("expired-old", owner, {
      createdAt: old,
      expiresAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS),
    });
    // Accepted, so it is the record of how somebody joined and it stays even
    // when it is older than the retention.
    insertInvitation("accepted-old", owner, {
      createdAt: old,
      expiresAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS),
      acceptedAt: old,
    });
    // Dead but recent, so the admin who issued it can still see what happened.
    insertInvitation("revoked-new", owner, {
      createdAt: daysAgo(1),
      expiresAt: daysAhead(6),
      revokedAt: daysAgo(1),
    });
    // Alive.
    insertInvitation("pending", owner, {
      createdAt: daysAgo(1),
      expiresAt: daysAhead(6),
    });

    const counts = runDailyMaintenance();
    expect(counts.deadInvitations).toBe(2);
    expect(ids("invitations")).toEqual([
      "accepted-old",
      "pending",
      "revoked-new",
    ]);
  });

  it("removes an AI invocation outside the stats window", () => {
    insertInvocation("old", daysAgo(31), owner);
    insertInvocation("recent", daysAgo(2), owner);

    const counts = runDailyMaintenance();
    expect(counts.oldInvocations).toBe(1);
    expect(ids("ai_invocations")).toEqual(["recent"]);
  });

  it("prunes score snapshots older than retention limit", () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Snapshot Test', ?)`,
      )
      .run(contactId, owner);

    const oldWeek = "2020-01-06";
    const recentWeek = "2026-09-14";
    insertScoreSnapshot(owner, contactId, oldWeek, 80);
    insertScoreSnapshot(owner, contactId, recentWeek, 85);

    const counts = runDailyMaintenance();
    expect(counts.prunedScoreSnapshots).toBe(1);

    const remaining = sqlite
      .prepare(`SELECT weekStart FROM score_snapshots WHERE ownerId = ?`)
      .all(owner) as { weekStart: string }[];
    expect(remaining.map((r) => r.weekStart)).toEqual([recentWeek]);
  });

  it("sweeps all eight tables in one pass", () => {
    insertAudit("a", daysAgo(AUDIT_RETENTION_DAYS + 1));
    insertSession("s", daysAgo(1), owner);
    insertChallenge("c", daysAgo(1));
    insertToken("t", owner, {
      revokedAt: daysAgo(REVOKED_TOKEN_RETENTION_DAYS + 1),
    });
    insertInvitation("i", owner, {
      createdAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS + 1),
      expiresAt: daysAgo(1),
      revokedAt: daysAgo(DEAD_INVITATION_RETENTION_DAYS + 1),
    });
    insertInvocation("v", daysAgo(31), owner);
    insertImport("m", "complete", daysAgo(IMPORT_RETENTION_DAYS + 1), owner);
    insertAuthLink("l", owner, {
      expiresAt: daysAgo(AUTH_LINK_RETENTION_DAYS + 1),
    });

    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId) VALUES (?, 'Snapshot Sweep', ?)`,
      )
      .run(contactId, owner);
    insertScoreSnapshot(owner, contactId, "2020-01-06", 80);

    expect(runDailyMaintenance()).toEqual({
      auditRows: 1,
      expiredSessions: 1,
      expiredChallenges: 1,
      agedAuthLinks: 1,
      agedTokens: 1,
      deadInvitations: 1,
      oldInvocations: 1,
      oldImports: 1,
      prunedScoreSnapshots: 1,
      // The sweep also checkpoints the write-ahead log, and how many pages
      // that moves depends on everything written before this test ran.
      // `expect.any` keeps the shape exhaustive, so a field added later still
      // fails here, without pinning a number nobody can predict.
      walPagesCheckpointed: expect.any(Number),
    });
    for (const table of [
      "audit_log",
      "sessions",
      "auth_challenges",
      "auth_links",
      "api_tokens",
      "invitations",
      "ai_invocations",
      "imports",
    ]) {
      expect(ids(table), table).toEqual([]);
    }
    expect(
      sqlite.prepare("SELECT COUNT(*) as n FROM score_snapshots").get(),
    ).toEqual({ n: 0 });
  });

  it("changes nothing on an instance with nothing to remove", () => {
    insertAudit("new", daysAgo(0));
    expect(runDailyMaintenance()).toEqual({
      auditRows: 0,
      expiredSessions: 0,
      expiredChallenges: 0,
      agedAuthLinks: 0,
      agedTokens: 0,
      deadInvitations: 0,
      oldInvocations: 0,
      oldImports: 0,
      prunedScoreSnapshots: 0,
      walPagesCheckpointed: expect.any(Number),
    });
    expect(ids("audit_log")).toEqual(["new"]);
  });
});

describe("the schedule", () => {
  it("sweeps at once and again a day later", () => {
    vi.useFakeTimers();
    insertAudit("first", daysAgo(AUDIT_RETENTION_DAYS + 1));

    const timer = startDailyMaintenance();
    expect(timer).not.toBeNull();
    // The boot pass took the first row.
    expect(ids("audit_log")).toEqual([]);

    // A second row ages while the process runs. Nothing removes it until the
    // interval comes round.
    insertAudit("second", daysAgo(AUDIT_RETENTION_DAYS + 1));
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    expect(ids("audit_log")).toEqual(["second"]);

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(ids("audit_log")).toEqual([]);

    if (timer) clearInterval(timer);
  });

  it("does nothing at all when background jobs are off", () => {
    vi.useFakeTimers();
    process.env.DISABLE_BACKGROUND_JOBS = "true";
    insertAudit("kept", daysAgo(AUDIT_RETENTION_DAYS + 1));

    const timer = startDailyMaintenance();
    expect(timer).toBeNull();
    // No boot pass.
    expect(ids("audit_log")).toEqual(["kept"]);

    // And no interval was left behind to take it later.
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
    expect(ids("audit_log")).toEqual(["kept"]);
  });
});
