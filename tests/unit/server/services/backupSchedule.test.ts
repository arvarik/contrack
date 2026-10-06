// Unit: the backup schedule's env parsing, with the empty-string trap.
// docker-compose renders an absent variable as `VAR: ""`, set but empty, and
// Number("") is 0, which would turn the default 24h snapshots off.
//
// The scheduled backup is a job. `startBackupSchedule` answers with the gap
// the job runs at, or null when the schedule is off.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startBackupSchedule } from "../../../../server/services/backupService.ts";

const saved: Record<string, string | undefined> = {};
const KEYS = ["BACKUP_INTERVAL_HOURS", "DISABLE_BACKGROUND_JOBS"];
let handle: number | null = null;

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("honors an explicit interval", () => {
    process.env.BACKUP_INTERVAL_HOURS = "6";
    handle = startBackupSchedule();
    expect(handle).not.toBeNull();
    expect(handle).toBe(6 * 3_600_000);
  });

  it("stays off under DISABLE_BACKGROUND_JOBS regardless", () => {
    process.env.DISABLE_BACKGROUND_JOBS = "true";
    process.env.BACKUP_INTERVAL_HOURS = "6";
    expect(startBackupSchedule()).toBeNull();
  });
});
