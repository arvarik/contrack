// =============================================================================
// Lifecycle Settings Service — trash retention and backup rotation policies
// =============================================================================
// Resolves instance lifecycle policies with fallbacks:
//   1. Persisted database setting (app_settings)
//   2. Environment variable override
//   3. Built-in defaults (trash 30d, backup interval 24h, backup keep 7)
// =============================================================================

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
  return raw !== undefined && raw !== "";
}

export function isBackupIntervalEnvSet(): boolean {
  const raw = process.env.BACKUP_INTERVAL_HOURS?.trim();
  return raw !== undefined && raw !== "";
}

export function isBackupKeepEnvSet(): boolean {
  const raw = process.env.BACKUP_KEEP?.trim();
  return raw !== undefined && raw !== "";
}

/**
 * Resolved trash retention window in days with source attribution.
 * Setting takes precedence, then environment variable, then 30 days default.
 */
export function trashRetentionDays(): ResolvedSetting<number> {
  const setting = getSetting<number>(SETTING_KEYS.trashRetentionDays);
  if (typeof setting === "number" && Number.isFinite(setting) && setting > 0) {
    return { value: Math.round(setting), source: "setting" };
  }

  const raw = process.env.TRASH_RETENTION_DAYS?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { value: Math.round(parsed), source: "env" };
    }
  }

  return { value: DEFAULT_TRASH_RETENTION_DAYS, source: "default" };
}

/**
 * Resolved backup interval in hours with source attribution.
 * 0 disables scheduled backups.
 * Setting takes precedence, then environment variable, then 24 hours default.
 */
export function backupIntervalHours(): ResolvedSetting<number> {
  const setting = getSetting<number>(SETTING_KEYS.backupIntervalHours);
  if (typeof setting === "number" && Number.isFinite(setting) && setting >= 0) {
    return { value: Math.round(setting), source: "setting" };
  }

  const raw = process.env.BACKUP_INTERVAL_HOURS?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { value: Math.round(parsed), source: "env" };
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
    return { value: Math.round(setting), source: "setting" };
  }

  const raw = process.env.BACKUP_KEEP?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { value: Math.round(parsed), source: "env" };
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

// Named aliases for convenience
export const getTrashRetentionDays = trashRetentionDays;
export const getBackupIntervalHours = backupIntervalHours;
export const getBackupKeep = backupKeep;
