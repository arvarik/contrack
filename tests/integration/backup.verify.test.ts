// =============================================================================
// Integration Tests — a snapshot is opened again before anybody trusts it
// =============================================================================
// `runBackup` wrote a file and rotated the old ones. Nothing ever opened it.
// A backup that restores nothing looks exactly like a backup that restores
// everything until the day somebody needs it, which is the worst possible day
// to find out.
//
// Every test here writes real snapshots of a real database into a real
// directory, and the damaged cases damage the actual file on disk. Verifying
// a file nobody has broken proves only that the check runs.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";

const { makeTestApp } = await import("./helpers.ts");
const { OWNED_TABLES, sqlite, ensureLocalOwner } =
  await import("../../server/db.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { contactService } =
  await import("../../server/services/contactService.ts");
const {
  BACKUPS_DIR,
  listBackups,
  runBackup,
  startBackupSchedule,
  verifyBackup,
} = await import("../../server/services/backupService.ts");
const { log } = await import("../../server/utils/logger.ts");

const app = makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

function sidecarOf(filename: string): string {
  return path.join(BACKUPS_DIR, `${filename}.json`);
}

function clearBackups(): void {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  for (const file of fs.readdirSync(BACKUPS_DIR)) {
    fs.rmSync(path.join(BACKUPS_DIR, file), { force: true });
  }
}

beforeEach(() => {
  clearBackups();
  delete process.env.BACKUP_KEEP;
});

afterAll(() => {
  clearBackups();
  delete process.env.BACKUP_KEEP;
});

describe("runBackup", () => {
  it("verifies the snapshot it just wrote and records the answer beside it", async () => {
    await contactService.bulkCreateContacts(scope, [
      { name: "Verified Person" },
    ]);

    const backup = await runBackup();

    expect(backup.verification?.ok).toBe(true);
    expect(backup.verification?.integrity).toBe("ok");
    expect(backup.verification?.problem).toBeUndefined();

    // The counts are the evidence, and `users` has to be among them: a
    // snapshot with contacts and no accounts is a database nobody can sign
    // in to.
    expect(backup.verification?.rows.contacts).toBeGreaterThan(0);
    expect(backup.verification?.rows.users).toBeGreaterThan(0);
    // Named against the real constant, not a count. A ninth owned table
    // added later has to be counted too, and a test that only checks the
    // length would keep passing while the new table went unverified.
    expect(Object.keys(backup.verification?.rows ?? {}).sort()).toEqual(
      [...OWNED_TABLES, "users"].sort(),
    );

    const sidecar = JSON.parse(
      fs.readFileSync(sidecarOf(backup.filename), "utf8"),
    ) as { ok: boolean; checkedAt: string };
    expect(sidecar.ok).toBe(true);
    expect(Date.parse(sidecar.checkedAt)).not.toBeNaN();
  });

  it("counts what the live database holds at the moment of the check", async () => {
    const before = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM contacts").get() as {
        n: number;
      }
    ).n;
    await contactService.bulkCreateContacts(scope, [
      { name: "Counted A" },
      { name: "Counted B" },
    ]);

    const backup = await runBackup();

    expect(backup.verification?.rows.contacts).toBe(before + 2);
    expect(backup.verification?.liveRows.contacts).toBe(before + 2);
  });

  it("lists the recorded verification with the snapshot", async () => {
    const backup = await runBackup();

    const listed = listBackups().find((b) => b.filename === backup.filename);
    expect(listed?.verification?.ok).toBe(true);
  });
});

describe("verifyBackup, when the file is not a backup", () => {
  it("fails a snapshot whose pages have been overwritten", async () => {
    const backup = await runBackup();
    const file = path.join(BACKUPS_DIR, backup.filename);

    // Write rubbish over the middle of the file. This is what a bad sector or
    // a half-finished copy looks like from here.
    const fd = fs.openSync(file, "r+");
    fs.writeSync(fd, Buffer.alloc(1024, 0x7f), 0, 1024, 4096);
    fs.closeSync(fd);

    const verification = verifyBackup(file);

    expect(verification.ok).toBe(false);
    expect(verification.problem).toBeTruthy();
  });

  it("fails a snapshot that is empty where the database is not", async () => {
    await contactService.bulkCreateContacts(scope, [{ name: "Present" }]);
    const backup = await runBackup();
    const file = path.join(BACKUPS_DIR, backup.filename);
    expect(verifyBackup(file).ok).toBe(true);

    // Sound, readable, correctly named, and holds nothing. This is the
    // failure the integrity check alone cannot see, and the one an operator
    // would otherwise discover while restoring.
    //
    // sqlite-vec has to be loaded to empty the table, because deleting a
    // contact fires a trigger that reaches the vec0 embedding tables.
    // `verifyBackup` never writes and only counts ordinary tables, which is
    // why it needs no extension of its own.
    const { default: Database } = await import("better-sqlite3");
    const sqliteVec = await import("sqlite-vec");
    const snapshot = new Database(file);
    sqliteVec.load(snapshot);
    snapshot.exec("DELETE FROM contacts");
    snapshot.close();

    const verification = verifyBackup(file);

    expect(verification.integrity).toBe("ok");
    expect(verification.ok).toBe(false);
    expect(verification.problem).toContain("contacts");
    expect(verification.rows.contacts).toBe(0);
    expect(verification.liveRows.contacts).toBeGreaterThan(0);
  });

  it("fails a file that will not open at all", () => {
    const file = path.join(BACKUPS_DIR, "curator-not-a-database.db");
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(file, "this is not a database");

    const verification = verifyBackup(file);

    expect(verification.ok).toBe(false);
    expect(verification.integrity).toBe("unreadable");
    expect(verification.checkedAt).toBeTruthy();
  });

  it("fails a file that is not there", () => {
    const verification = verifyBackup(
      path.join(BACKUPS_DIR, "curator-missing.db"),
    );

    expect(verification.ok).toBe(false);
    expect(verification.integrity).toBe("unreadable");
  });
});

describe("rotation", () => {
  it("takes each snapshot's verification with it", async () => {
    process.env.BACKUP_KEEP = "2";

    const first = await runBackup();
    // The filename carries a whole second, so three snapshots inside one
    // second would be one file. The rows make each snapshot different and the
    // writes push the clock along.
    await contactService.bulkCreateContacts(scope, [{ name: "Rotate A" }]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await runBackup();
    await contactService.bulkCreateContacts(scope, [{ name: "Rotate B" }]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await runBackup();

    const remaining = listBackups();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((b) => b.filename)).not.toContain(first.filename);

    // A sidecar left behind would be adopted by the next file to take that
    // name, and it would say a snapshot was verified that never was.
    expect(fs.existsSync(sidecarOf(first.filename))).toBe(false);
    for (const backup of remaining) {
      expect(fs.existsSync(sidecarOf(backup.filename))).toBe(true);
    }
  }, 20_000);

  it("leaves no WAL companions beside a snapshot it opened", async () => {
    const backup = await runBackup();

    // Reading a snapshot builds its shared memory index beside it, and a read
    // only connection cannot take it away again on close. Left alone, the
    // backups directory gains a 32 KB `-shm` and an empty `-wal` for every
    // snapshot ever verified, and rotation is not looking for either.
    const files = fs.readdirSync(BACKUPS_DIR);
    expect(files).toContain(backup.filename);
    expect(files.filter((f) => f.endsWith("-shm"))).toEqual([]);
    expect(files.filter((f) => f.endsWith("-wal"))).toEqual([]);
  });

  it("rotates away a companion an older version left behind", async () => {
    process.env.BACKUP_KEEP = "1";
    const first = await runBackup();
    const stale = path.join(BACKUPS_DIR, `${first.filename}-shm`);
    fs.writeFileSync(stale, Buffer.alloc(32768));

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await runBackup();

    expect(fs.existsSync(stale)).toBe(false);
  }, 20_000);

  it("never lists a sidecar as a backup", async () => {
    await runBackup();

    const files = fs.readdirSync(BACKUPS_DIR);
    expect(files.some((f) => f.endsWith(".db.json"))).toBe(true);
    expect(listBackups().every((b) => b.filename.endsWith(".db"))).toBe(true);
  });
});

describe("the backups API", () => {
  it("sends the verification with every snapshot", async () => {
    const created = await request(app).post("/api/backups").expect(201);
    expect(created.body.verification.ok).toBe(true);

    const listed = await request(app).get("/api/backups").expect(200);
    const row = listed.body.backups.find(
      (b: { filename: string }) => b.filename === created.body.filename,
    );
    expect(row.verification.ok).toBe(true);
    expect(row.verification.rows.users).toBeGreaterThan(0);
  });

  it("records in the audit log whether the snapshot verified", async () => {
    const created = await request(app).post("/api/backups").expect(201);

    const row = sqlite
      .prepare(
        `SELECT details FROM audit_log
          WHERE action = 'backup.created' AND targetId = ?`,
      )
      .get(created.body.filename) as { details: string } | undefined;

    expect(row).toBeTruthy();
    expect(JSON.parse(row!.details)).toMatchObject({ verified: true });
  });
});

describe("the warning at boot", () => {
  /**
   * Start the schedule, collect what it said, and stop it again.
   *
   * `DISABLE_BACKGROUND_JOBS` is on for every integration file, and it is the
   * first thing `startBackupSchedule` looks at, so it has to come off for the
   * length of the call. The interval is cleared and the startup snapshot is
   * fifteen seconds away and unrefed, so nothing outlives this.
   */
  function bootWarnings(intervalHours: string): string[] {
    const said: string[] = [];
    const warn = vi
      .spyOn(log, "warn")
      .mockImplementation((_scope: string, message: string) => {
        said.push(message);
      });
    const previous = process.env.DISABLE_BACKGROUND_JOBS;
    process.env.DISABLE_BACKGROUND_JOBS = "";
    process.env.BACKUP_INTERVAL_HOURS = intervalHours;
    try {
      const handle = startBackupSchedule();
      if (handle) clearInterval(handle);
    } finally {
      process.env.DISABLE_BACKGROUND_JOBS = previous;
      delete process.env.BACKUP_INTERVAL_HOURS;
      warn.mockRestore();
    }
    return said;
  }

  it("says nothing when the newest verified snapshot is recent", async () => {
    await runBackup();

    expect(bootWarnings("24")).toEqual([]);
  });

  it("complains when the newest verified snapshot is older than two intervals", async () => {
    const backup = await runBackup();
    // Three days back, against a one day interval. `listBackups` reads mtime,
    // which is what moving the file's timestamp changes.
    const old = new Date(Date.now() - 3 * 24 * 3_600_000);
    fs.utimesSync(path.join(BACKUPS_DIR, backup.filename), old, old);

    const warnings = bootWarnings("24");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("more than two 24h intervals");
    expect(warnings[0]).toContain(backup.filename);
  });

  it("complains when there are no snapshots at all", () => {
    clearBackups();

    const warnings = bootWarnings("24");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("No snapshots exist yet");
  });

  it("complains when snapshots exist and none of them passed", async () => {
    const backup = await runBackup();
    // Take the verification away. A snapshot nobody checked and a snapshot
    // that failed are different things, and neither is one to rely on.
    fs.rmSync(sidecarOf(backup.filename), { force: true });

    const warnings = bootWarnings("24");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("has passed verification");
  });

  it("says nothing when scheduled backups are switched off", () => {
    clearBackups();

    expect(bootWarnings("0")).toEqual([]);
  });
});
