import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sqlite } from "../../server/db.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import {
  trashRetentionDays,
  backupIntervalHours,
  backupKeep,
  setTrashRetentionDays,
  setBackupIntervalHours,
  setBackupKeep,
} from "../../server/services/lifecycleSettings.ts";

describe("lifecycleSettings", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sqlite.prepare("DELETE FROM app_settings").run();
    clearSettingsCache();
    delete process.env.TRASH_RETENTION_DAYS;
    delete process.env.BACKUP_INTERVAL_HOURS;
    delete process.env.BACKUP_KEEP;
  });

  afterEach(() => {
    sqlite.prepare("DELETE FROM app_settings").run();
    clearSettingsCache();
    process.env = { ...originalEnv };
  });

  // Each setting resolves the same way: setting, then env, then default. The
  // three together, through GET /api/admin/settings, are tested in
  // tests/integration/api.admin.test.ts.

  it.each([
    ["trashRetentionDays", 30, trashRetentionDays],
    ["backupIntervalHours", 24, backupIntervalHours],
    ["backupKeep", 7, backupKeep],
  ] as const)(
    "%s returns its default %i when neither setting nor env is set",
    (_name, value, resolve) => {
      expect(resolve()).toEqual({ value, source: "default" });
    },
  );

  it.each([
    [
      "trashRetentionDays",
      "TRASH_RETENTION_DAYS",
      "45",
      45,
      trashRetentionDays,
    ],
    [
      "backupIntervalHours",
      "BACKUP_INTERVAL_HOURS",
      "12",
      12,
      backupIntervalHours,
    ],
    // 0 disables scheduled backups, from either source.
    [
      "backupIntervalHours",
      "BACKUP_INTERVAL_HOURS",
      "0",
      0,
      backupIntervalHours,
    ],
    ["backupKeep", "BACKUP_KEEP", "14", 14, backupKeep],
  ] as const)(
    "%s takes %s=%s when no setting exists",
    (_name, envVar, raw, value, resolve) => {
      process.env[envVar] = raw;
      expect(resolve()).toEqual({ value, source: "env" });
    },
  );

  it.each([
    [
      "trashRetentionDays",
      60,
      "TRASH_RETENTION_DAYS",
      "45",
      setTrashRetentionDays,
      trashRetentionDays,
    ],
    [
      "backupIntervalHours",
      6,
      "BACKUP_INTERVAL_HOURS",
      "12",
      setBackupIntervalHours,
      backupIntervalHours,
    ],
    [
      "backupIntervalHours",
      0,
      "BACKUP_INTERVAL_HOURS",
      "12",
      setBackupIntervalHours,
      backupIntervalHours,
    ],
    ["backupKeep", 30, "BACKUP_KEEP", "14", setBackupKeep, backupKeep],
  ] as const)(
    "%s prefers the setting %i over %s=%s",
    (_name, value, envVar, raw, set, resolve) => {
      process.env[envVar] = raw;
      set(value);
      expect(resolve()).toEqual({ value, source: "setting" });
    },
  );
});
