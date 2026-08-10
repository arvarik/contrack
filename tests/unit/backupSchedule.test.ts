// =============================================================================
// Backup schedule — env parsing, incl. the empty-string trap
// =============================================================================
// docker-compose renders an absent variable as `VAR: ""` — set, but empty.
// The schedule guard used `!== undefined`, so Compose users got Number("")=0
// and the disable branch: default 24h snapshots silently OFF. Found by the
// independent v1.5.4 review; pinned here so it cannot come back.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startBackupSchedule } from "../../server/services/backupService.ts";

const saved: Record<string, string | undefined> = {};
const KEYS = ["BACKUP_INTERVAL_HOURS", "DISABLE_BACKGROUND_JOBS"];
let handle: NodeJS.Timeout | null = null;

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  if (handle) clearInterval(handle);
  handle = null;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("startBackupSchedule", () => {
  it("schedules with the variable unset (the default)", () => {
    handle = startBackupSchedule();
    expect(handle).not.toBeNull();
  });

  it("schedules with the variable set to EMPTY STRING — what Compose sends", () => {
    process.env.BACKUP_INTERVAL_HOURS = "";
    handle = startBackupSchedule();
    expect(handle).not.toBeNull();
  });

  it("treats whitespace like empty", () => {
    process.env.BACKUP_INTERVAL_HOURS = "  ";
    handle = startBackupSchedule();
    expect(handle).not.toBeNull();
  });

  it("disables only on an explicit zero", () => {
    process.env.BACKUP_INTERVAL_HOURS = "0";
    expect(startBackupSchedule()).toBeNull();
  });

  it("disables on garbage rather than scheduling at NaN", () => {
    process.env.BACKUP_INTERVAL_HOURS = "daily";
    expect(startBackupSchedule()).toBeNull();
  });

  it("honours an explicit interval", () => {
    process.env.BACKUP_INTERVAL_HOURS = "6";
    handle = startBackupSchedule();
    expect(handle).not.toBeNull();
  });

  it("stays off under DISABLE_BACKGROUND_JOBS regardless", () => {
    process.env.DISABLE_BACKGROUND_JOBS = "true";
    process.env.BACKUP_INTERVAL_HOURS = "6";
    expect(startBackupSchedule()).toBeNull();
  });
});
