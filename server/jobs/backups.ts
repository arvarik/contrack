// Snapshot jobs: the startup snapshot, 15 seconds after boot so migrations and
// backfills settle first, and the scheduled backup every BACKUP_INTERVAL_HOURS.
// The interval is a setting: the runner reads it at each scheduling, and
// `rescheduleBackups` (backupService) moves the queued run when it changes. 0
// turns the scheduled backup off; the startup snapshot runs either way.

import { defineJob } from "./runner.ts";
import {
  SCHEDULED_BACKUP_JOB,
  backupIntervalMs,
  runBackup,
} from "../services/backupService.ts";

export const BACKUP_JOBS = [
  defineJob({
    kind: "backup.startup",
    atStart: 15_000,
    async run() {
      await runBackup();
    },
  }),
  defineJob({
    kind: SCHEDULED_BACKUP_JOB,
    every: backupIntervalMs,
    async run() {
      await runBackup();
    },
  }),
];
