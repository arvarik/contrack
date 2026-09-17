/**
 * Pure function to group history entries by day and month.
 *
 * Groups in order:
 * 1. Pinned (pinned rows appear once, never duplicate into date groups)
 * 2. Today
 * 3. Yesterday
 * 4. This week (weekStartsOn: 1, Monday)
 * 5. Months ("August 2026", "July 2026", ...)
 *
 * @module views/search/historyGroups
 */

import { format, isSameDay, isSameWeek, subDays } from "date-fns";
import type { HistoryEntry } from "../../../shared/searchHistory";
import { parseServerTime } from "../../lib/datetime";

export interface HistoryGroup {
  key: string;
  label: string;
  entries: HistoryEntry[];
}

/**
 * Split a list of history entries into headed groups.
 *
 * @param entries The entries to group.
 * @param now Reference clock date (defaults to current instant).
 */
export function groupHistoryEntries(
  entries: readonly HistoryEntry[],
  now: Date = new Date(),
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];

  // Pinned entries appear once in the Pinned group only.
  const pinned = entries.filter((e) => e.pinned);
  if (pinned.length > 0) {
    groups.push({
      key: "pinned",
      label: "Pinned",
      entries: [...pinned],
    });
  }

  const unpinned = entries.filter((e) => !e.pinned);

  const todayEntries: HistoryEntry[] = [];
  const yesterdayEntries: HistoryEntry[] = [];
  const thisWeekEntries: HistoryEntry[] = [];
  const monthMap = new Map<
    string,
    { label: string; entries: HistoryEntry[] }
  >();

  const yesterday = subDays(now, 1);

  for (const entry of unpinned) {
    const date = parseServerTime(entry.lastRunAt) ?? new Date(entry.lastRunAt);
    if (isSameDay(date, now)) {
      todayEntries.push(entry);
    } else if (isSameDay(date, yesterday)) {
      yesterdayEntries.push(entry);
    } else if (isSameWeek(date, now, { weekStartsOn: 1 })) {
      thisWeekEntries.push(entry);
    } else {
      const monthKey = format(date, "yyyy-MM");
      const monthLabel = format(date, "MMMM yyyy");
      let bucket = monthMap.get(monthKey);
      if (!bucket) {
        bucket = { label: monthLabel, entries: [] };
        monthMap.set(monthKey, bucket);
      }
      bucket.entries.push(entry);
    }
  }

  if (todayEntries.length > 0) {
    groups.push({
      key: "today",
      label: "Today",
      entries: todayEntries,
    });
  }

  if (yesterdayEntries.length > 0) {
    groups.push({
      key: "yesterday",
      label: "Yesterday",
      entries: yesterdayEntries,
    });
  }

  if (thisWeekEntries.length > 0) {
    groups.push({
      key: "this-week",
      label: "This week",
      entries: thisWeekEntries,
    });
  }

  // Month groups ordered newest month first
  const sortedMonthKeys = Array.from(monthMap.keys()).sort((a, b) =>
    b.localeCompare(a),
  );
  for (const key of sortedMonthKeys) {
    const bucket = monthMap.get(key)!;
    groups.push({
      key,
      label: bucket.label,
      entries: bucket.entries,
    });
  }

  return groups;
}
