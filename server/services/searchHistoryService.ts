import crypto from "crypto";
import { sqlite } from "../db.ts";
import {
  normalizeQuery,
  type HistoryEntry,
  type HistoryMode,
  type RecordHistoryInput,
} from "../../shared/searchHistory.ts";
import { getPreferences } from "./userPreferencesService.ts";

export interface SearchHistoryRow {
  id: string;
  ownerId: string;
  mode: string;
  query: string;
  normalizedQuery: string;
  resultCount: number | null;
  resultIds: string | null;
  fallback: number;
  pinned: number;
  runCount: number;
  createdAt: string;
  lastRunAt: string;
}

export interface ListHistoryParams {
  mode?: HistoryMode;
  q?: string;
  pinned?: boolean;
  cursor?: string;
  limit?: number;
}

function mapRowToEntry(row: SearchHistoryRow): HistoryEntry {
  let resultIds: string[] = [];
  if (row.resultIds) {
    try {
      const parsed = JSON.parse(row.resultIds);
      if (Array.isArray(parsed)) {
        resultIds = parsed;
      }
    } catch {
      resultIds = [];
    }
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    mode: row.mode as HistoryMode,
    query: row.query,
    normalizedQuery: row.normalizedQuery,
    resultCount: row.resultCount,
    resultIds,
    fallback: row.fallback === 1,
    pinned: row.pinned === 1,
    runCount: row.runCount,
    createdAt: row.createdAt,
    lastRunAt: row.lastRunAt,
  };
}

function parseCursor(
  cursor: string | undefined,
): { lastRunAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const split = raw.lastIndexOf("|");
    if (split <= 0) return null;
    return {
      lastRunAt: raw.slice(0, split),
      id: raw.slice(split + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Record a search question in history.
 *
 * Upserts on (ownerId, mode, normalizedQuery):
 * - If new: inserts row with runCount = 1, pinned = 0
 * - If exists: bumps runCount, moves lastRunAt to now, updates query snapshot (resultCount, resultIds, fallback)
 * Trims resultIds to at most 30 items.
 */
export function record(
  ownerId: string,
  data: RecordHistoryInput,
): HistoryEntry {
  const normalizedQuery = normalizeQuery(data.query);
  const trimmedIds = data.resultIds ? data.resultIds.slice(0, 30) : null;
  const resultIdsJson = trimmedIds ? JSON.stringify(trimmedIds) : null;
  const fallbackInt = data.fallback ? 1 : 0;
  const resultCount = data.resultCount ?? null;
  const id = crypto.randomUUID();

  const row = sqlite
    .prepare(
      `INSERT INTO search_history (
         id, ownerId, mode, query, normalizedQuery,
         resultCount, resultIds, fallback, pinned, runCount,
         createdAt, lastRunAt
       ) VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, ?, 0, 1,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT(ownerId, mode, normalizedQuery) DO UPDATE SET
         query = excluded.query,
         resultCount = excluded.resultCount,
         resultIds = excluded.resultIds,
         fallback = excluded.fallback,
         runCount = search_history.runCount + 1,
         lastRunAt = CURRENT_TIMESTAMP
       RETURNING id, ownerId, mode, query, normalizedQuery, resultCount, resultIds, fallback, pinned, runCount, createdAt, lastRunAt`,
    )
    .get(
      id,
      ownerId,
      data.mode,
      data.query.trim(),
      normalizedQuery,
      resultCount,
      resultIdsJson,
      fallbackInt,
    ) as SearchHistoryRow;

  return mapRowToEntry(row);
}

/**
 * List search history entries for an owner.
 *
 * Supports filtering by mode, pinned, and query text (`normalizedQuery LIKE ?`).
 * Uses cursor-based pagination (base64 of `lastRunAt|id`) with ordering `lastRunAt DESC, id DESC`.
 * Computes `total` count without the cursor clause.
 */
export function list(
  ownerId: string,
  params: ListHistoryParams = {},
): {
  entries: HistoryEntry[];
  nextCursor: string | null;
  total: number;
} {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const cursor = parseCursor(params.cursor);

  const filterClauses: string[] = [];
  const filterValues: unknown[] = [ownerId];

  if (params.mode !== undefined) {
    filterClauses.push("AND mode = ?");
    filterValues.push(params.mode);
  }

  if (params.pinned !== undefined) {
    filterClauses.push("AND pinned = ?");
    filterValues.push(params.pinned ? 1 : 0);
  }

  if (params.q && params.q.trim()) {
    filterClauses.push("AND normalizedQuery LIKE ?");
    filterValues.push(`%${params.q.trim().toLowerCase()}%`);
  }

  // Compute total (without cursor)
  const totalRow = sqlite
    .prepare(
      `SELECT COUNT(*) as count FROM search_history WHERE ownerId = ? ${filterClauses.join(" ")}`,
    )
    .get(...filterValues) as { count: number };
  const total = totalRow.count;

  // Build query with cursor
  const queryClauses = [...filterClauses];
  const queryValues = [...filterValues];

  if (cursor) {
    queryClauses.push("AND (lastRunAt < ? OR (lastRunAt = ? AND id < ?))");
    queryValues.push(cursor.lastRunAt, cursor.lastRunAt, cursor.id);
  }

  const rows = sqlite
    .prepare(
      `SELECT id, ownerId, mode, query, normalizedQuery, resultCount, resultIds, fallback, pinned, runCount, createdAt, lastRunAt
       FROM search_history
       WHERE ownerId = ? ${queryClauses.join(" ")}
       ORDER BY lastRunAt DESC, id DESC
       LIMIT ?`,
    )
    .all(...queryValues, limit + 1) as SearchHistoryRow[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const entries = rows.map(mapRowToEntry);
  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last
      ? Buffer.from(`${last.lastRunAt}|${last.id}`).toString("base64")
      : null;

  return {
    entries,
    nextCursor,
    total,
  };
}

/**
 * Update the pinned state of a search history entry.
 * Returns the updated entry, or null if not found.
 */
export function setPinned(
  ownerId: string,
  id: string,
  pinned: boolean,
): HistoryEntry | null {
  const result = sqlite
    .prepare(
      `UPDATE search_history
       SET pinned = ?
       WHERE id = ? AND ownerId = ?`,
    )
    .run(pinned ? 1 : 0, id, ownerId);

  if (result.changes === 0) {
    return null;
  }

  const row = sqlite
    .prepare(
      `SELECT id, ownerId, mode, query, normalizedQuery, resultCount, resultIds, fallback, pinned, runCount, createdAt, lastRunAt
       FROM search_history
       WHERE id = ? AND ownerId = ?`,
    )
    .get(id, ownerId) as SearchHistoryRow | undefined;

  return row ? mapRowToEntry(row) : null;
}

/**
 * Remove a search history entry.
 * Returns true if removed, false if not found.
 */
export function remove(ownerId: string, id: string): boolean {
  const result = sqlite
    .prepare(
      `DELETE FROM search_history
       WHERE id = ? AND ownerId = ?`,
    )
    .run(id, ownerId);

  return result.changes > 0;
}

/**
 * Clear search history for an owner, optionally limited to one mode.
 * Returns the count of deleted rows.
 */
export function clear(
  ownerId: string,
  mode?: HistoryMode,
): { deleted: number } {
  let result;
  if (mode !== undefined) {
    result = sqlite
      .prepare(
        `DELETE FROM search_history
         WHERE ownerId = ? AND mode = ?`,
      )
      .run(ownerId, mode);
  } else {
    result = sqlite
      .prepare(
        `DELETE FROM search_history
         WHERE ownerId = ?`,
      )
      .run(ownerId);
  }

  return { deleted: result.changes };
}

/**
 * One-time backfill: import searchHistory preference entries into search_history
 * if the owner has no rows.
 *
 * Normal and action entries are imported as mode 'palette'.
 * AI entries are imported as mode 'people' with leading '? ' stripped.
 * Idempotent via the (ownerId, mode, normalizedQuery) unique constraint.
 */
export function backfillFromPreferences(ownerId: string): number {
  const existing = sqlite
    .prepare(`SELECT 1 FROM search_history WHERE ownerId = ? LIMIT 1`)
    .get(ownerId);

  if (existing) {
    return 0;
  }

  const prefs = getPreferences(ownerId);
  const legacy = prefs.searchHistory;
  if (!legacy || legacy.length === 0) {
    return 0;
  }

  const insertStmt = sqlite.prepare(
    `INSERT INTO search_history (
       id, ownerId, mode, query, normalizedQuery,
       resultCount, resultIds, fallback, pinned, runCount,
       createdAt, lastRunAt
     ) VALUES (
       ?, ?, ?, ?, ?,
       NULL, NULL, 0, 0, 1,
       ?, ?
     )
     ON CONFLICT(ownerId, mode, normalizedQuery) DO NOTHING`,
  );

  let inserted = 0;
  const runTransaction = sqlite.transaction(() => {
    for (const item of legacy) {
      let mode: HistoryMode;
      let queryText: string;

      if (item.mode === "ai") {
        mode = "people";
        queryText = item.query.replace(/^\s*\?\s+/, "").trim();
      } else {
        mode = "palette";
        queryText = item.query.trim();
      }

      if (!queryText) continue;
      const normalized = normalizeQuery(queryText);
      if (!normalized) continue;

      const timestamp =
        typeof item.timestamp === "number" &&
        !isNaN(item.timestamp) &&
        item.timestamp > 0
          ? new Date(item.timestamp).toISOString()
          : new Date().toISOString();

      const res = insertStmt.run(
        crypto.randomUUID(),
        ownerId,
        mode,
        queryText,
        normalized,
        timestamp,
        timestamp,
      );
      if (res.changes > 0) {
        inserted++;
      }
    }
  });

  runTransaction();
  return inserted;
}

export const searchHistoryService = {
  record,
  list,
  setPinned,
  remove,
  clear,
  backfillFromPreferences,
};
