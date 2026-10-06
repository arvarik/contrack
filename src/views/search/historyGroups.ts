/**
 * Groups history entries, in order: Pinned (only there), Today, Yesterday,
 * This week, then months, newest first ("August 2026").
 */

import { format, isSameDay, isSameWeek, subDays } from "date-fns";
import type { HistoryEntry } from "../../../shared/searchHistory";
import { parseServerTime } from "../../lib/datetime";

interface HistoryGroup {
  key: string;
  label: string;
  entries: HistoryEntry[];
}

export function groupHistoryEntries(
  entries: readonly HistoryEntry[],
  now: Date = new Date(),
  weekStart: "monday" | "sunday" = "monday",
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  const weekStartsOnDay = weekStart === "sunday" ? 0 : 1;

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
    if (isNaN(date.getTime())) continue;

    if (isSameDay(date, now)) {
      todayEntries.push(entry);
    } else if (isSameDay(date, yesterday)) {
      yesterdayEntries.push(entry);
    } else if (isSameWeek(date, now, { weekStartsOn: weekStartsOnDay })) {
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
