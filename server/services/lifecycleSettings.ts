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

/** How one policy reads its setting and its environment variable. */
interface Rule {
  key: string;
  env: string;
  fallback: number;
  min: number;
  max: number;
  /** Zero is a real value: it turns the policy off. */
  zeroOk: boolean;
  /** An environment value that is set but unusable turns the policy off. */
  badEnvIsOff?: boolean;
}

const TRASH: Rule = {
  key: SETTING_KEYS.trashRetentionDays,
  env: "TRASH_RETENTION_DAYS",
  fallback: DEFAULT_TRASH_RETENTION_DAYS,
  min: 1,
  max: 365,
  zeroOk: false,
};
const INTERVAL: Rule = {
  key: SETTING_KEYS.backupIntervalHours,
  env: "BACKUP_INTERVAL_HOURS",
  fallback: DEFAULT_BACKUP_INTERVAL_HOURS,
  min: 0,
  max: 168,
  zeroOk: true,
  badEnvIsOff: true,
};
const KEEP: Rule = {
  key: SETTING_KEYS.backupKeep,
  env: "BACKUP_KEEP",
  fallback: DEFAULT_BACKUP_KEEP,
  min: 1,
  max: 100,
  zeroOk: false,
};

const usable = (n: number, rule: Rule) =>
  Number.isFinite(n) && (rule.zeroOk ? n >= 0 : n > 0);
const clamp = (n: number, rule: Rule) =>
  Math.min(rule.max, Math.max(rule.min, Math.round(n)));

/** The environment number: undefined when unset or blank, NaN when unusable. */
function envNumber(rule: Rule): number | undefined {
  const raw = process.env[rule.env]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return usable(n, rule) ? n : NaN;
}

const envSet = (rule: Rule) => !Number.isNaN(envNumber(rule) ?? NaN);

export const isTrashRetentionEnvSet = () => envSet(TRASH);
export const isBackupIntervalEnvSet = () => envSet(INTERVAL);
export const isBackupKeepEnvSet = () => envSet(KEEP);

/** The saved setting, else the environment variable, else the default. */
function resolve(rule: Rule): ResolvedSetting<number> {
  const saved = getSetting<number>(rule.key);
  if (typeof saved === "number" && usable(saved, rule)) {
    return { value: clamp(saved, rule), source: "setting" };
  }
  const fromEnv = envNumber(rule);
  if (fromEnv !== undefined) {
    if (!Number.isNaN(fromEnv)) {
      return { value: clamp(fromEnv, rule), source: "env" };
    }
    if (rule.badEnvIsOff) return { value: 0, source: "env" };
  }
  return { value: rule.fallback, source: "default" };
}

/** Days before the Trash is emptied: setting, then env, then 30. */
export const trashRetentionDays = () => resolve(TRASH);

/** Hours between scheduled backups: setting, then env, then 24. 0 is off. */
export const backupIntervalHours = () => resolve(INTERVAL);

/** Backups to keep: setting, then env, then 7. */
export const backupKeep = () => resolve(KEEP);

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

export function setBackupIntervalHours(hours: number): void {
  setSetting(SETTING_KEYS.backupIntervalHours, hours);
}

export function setBackupKeep(keep: number): void {
  setSetting(SETTING_KEYS.backupKeep, keep);
}
