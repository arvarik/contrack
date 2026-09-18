import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sqlite } from "../../server/db.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import {
  trashRetentionDays,
  backupIntervalHours,
  backupKeep,
  getLifecycleSettings,
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

  describe("trashRetentionDays", () => {
    it("returns default 30 days when neither setting nor env is set", () => {
      const res = trashRetentionDays();
      expect(res).toEqual({ value: 30, source: "default" });
    });

    it("returns env value when TRASH_RETENTION_DAYS is set and no setting exists", () => {
      process.env.TRASH_RETENTION_DAYS = "45";
      const res = trashRetentionDays();
      expect(res).toEqual({ value: 45, source: "env" });
    });

    it("prioritizes setting over env over default", () => {
      process.env.TRASH_RETENTION_DAYS = "45";
      setTrashRetentionDays(60);
      const res = trashRetentionDays();
      expect(res).toEqual({ value: 60, source: "setting" });
    });
  });

  describe("backupIntervalHours", () => {
    it("returns default 24 hours when neither setting nor env is set", () => {
      const res = backupIntervalHours();
      expect(res).toEqual({ value: 24, source: "default" });
    });

    it("returns env value when BACKUP_INTERVAL_HOURS is set and no setting exists", () => {
      process.env.BACKUP_INTERVAL_HOURS = "12";
      const res = backupIntervalHours();
      expect(res).toEqual({ value: 12, source: "env" });
    });

    it("supports 0 to disable via env", () => {
      process.env.BACKUP_INTERVAL_HOURS = "0";
      const res = backupIntervalHours();
      expect(res).toEqual({ value: 0, source: "env" });
    });

    it("prioritizes setting over env over default", () => {
      process.env.BACKUP_INTERVAL_HOURS = "12";
      setBackupIntervalHours(6);
      const res = backupIntervalHours();
      expect(res).toEqual({ value: 6, source: "setting" });
    });

    it("supports 0 to disable via setting", () => {
      process.env.BACKUP_INTERVAL_HOURS = "12";
      setBackupIntervalHours(0);
      const res = backupIntervalHours();
      expect(res).toEqual({ value: 0, source: "setting" });
    });
  });

  describe("backupKeep", () => {
    it("returns default 7 snapshots when neither setting nor env is set", () => {
      const res = backupKeep();
      expect(res).toEqual({ value: 7, source: "default" });
    });

    it("returns env value when BACKUP_KEEP is set and no setting exists", () => {
      process.env.BACKUP_KEEP = "14";
      const res = backupKeep();
      expect(res).toEqual({ value: 14, source: "env" });
    });

    it("prioritizes setting over env over default", () => {
      process.env.BACKUP_KEEP = "14";
      setBackupKeep(30);
      const res = backupKeep();
      expect(res).toEqual({ value: 30, source: "setting" });
    });
  });

  describe("getLifecycleSettings", () => {
    it("returns all three resolved settings", () => {
      setTrashRetentionDays(90);
      process.env.BACKUP_INTERVAL_HOURS = "48";
      // backupKeep left at default

      const all = getLifecycleSettings();
      expect(all).toEqual({
        trashRetentionDays: { value: 90, source: "setting" },
        backupIntervalHours: { value: 48, source: "env" },
        backupKeep: { value: 7, source: "default" },
      });
    });
  });
});
