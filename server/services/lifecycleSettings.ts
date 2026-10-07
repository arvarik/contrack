// Trash retention and backup policies, each resolved from the saved setting
// (app_settings), else the environment variable, else the default (trash 30
// days, backups every 24 hours, 7 kept).

import { getSetting, setSetting, SETTING_KEYS } from "./settingsService.ts";

export type SettingSource = "setting" | "env" | "default";

export interface ResolvedSetting<T = number> {
  value: T;
  source: SettingSource;
}

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const DEFAULT_BACKUP_INTERVAL_HOURS = 24;
export const DEFAULT_BACKUP_KEEP = 7;

export function isTrashRetentionEnvSet(): boolean {
  const raw = process.env.TRASH_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === "") return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0;
}

export function isBackupIntervalEnvSet(): boolean {
  const raw = process.env.BACKUP_INTERVAL_HOURS?.trim();
  if (raw === undefined || raw === "") return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function isBackupKeepEnvSet(): boolean {
  const raw = process.env.BACKUP_KEEP?.trim();
  if (raw === undefined || raw === "") return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * Resolved trash retention window in days with source attribution.
 * Setting takes precedence, then environment variable, then 30 days default.
 */
export function trashRetentionDays(): ResolvedSetting<number> {
  const setting = getSetting<number>(SETTING_KEYS.trashRetentionDays);
  if (typeof setting === "number" && Number.isFinite(setting) && setting > 0) {
    return {
      value: Math.min(365, Math.max(1, Math.round(setting))),
      source: "setting",
    };
  }

  const raw = process.env.TRASH_RETENTION_DAYS?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        value: Math.min(365, Math.max(1, Math.round(parsed))),
        source: "env",
      };
    }
  }

  return { value: DEFAULT_TRASH_RETENTION_DAYS, source: "default" };
}

/**
 * The backup interval in hours, with its source; 0 turns scheduled backups off.
 * The setting wins, then the environment variable, then 24 hours.
 */
export function backupIntervalHours(): ResolvedSetting<number> {
  const setting = getSetting<number>(SETTING_KEYS.backupIntervalHours);
  if (typeof setting === "number" && Number.isFinite(setting) && setting >= 0) {
    return {
      value: Math.min(168, Math.max(0, Math.round(setting))),
      source: "setting",
    };
  }

  const raw = process.env.BACKUP_INTERVAL_HOURS?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return {
        value: Math.min(168, Math.max(0, Math.round(parsed))),
        source: "env",
      };
    }
    // Invalid non-number disables schedule rather than running with NaN
    return { value: 0, source: "env" };
  }

  return { value: DEFAULT_BACKUP_INTERVAL_HOURS, source: "default" };
}

/**
 * Resolved backup retention count with source attribution.
 * Setting takes precedence, then environment variable, then 7 snapshots default.
 */
export function backupKeep(): ResolvedSetting<number> {
  const setting = getSetting<number>(SETTING_KEYS.backupKeep);
  if (typeof setting === "number" && Number.isFinite(setting) && setting > 0) {
    return {
      value: Math.min(100, Math.max(1, Math.round(setting))),
      source: "setting",
    };
  }

  const raw = process.env.BACKUP_KEEP?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        value: Math.min(100, Math.max(1, Math.round(parsed))),
        source: "env",
      };
    }
  }

  return { value: DEFAULT_BACKUP_KEEP, source: "default" };
}

export function getLifecycleSettings() {
  return {
    trashRetentionDays: trashRetentionDays(),
    backupIntervalHours: backupIntervalHours(),
    backupKeep: backupKeep(),
  };
}

export function setTrashRetentionDays(days: number): void {
  setSetting(SETTING_KEYS.trashRetentionDays, days);
}

let backupIntervalChangeCallback: (() => void) | null = null;

export function registerBackupIntervalChangeListener(fn: () => void): void {
  backupIntervalChangeCallback = fn;
}

export function setBackupIntervalHours(hours: number): void {
  setSetting(SETTING_KEYS.backupIntervalHours, hours);
  backupIntervalChangeCallback?.();
}

export function setBackupKeep(keep: number): void {
  setSetting(SETTING_KEYS.backupKeep, keep);
}
