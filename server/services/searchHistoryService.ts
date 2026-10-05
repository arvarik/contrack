import crypto from "crypto";
import { sqlite } from "../db.ts";
import {
  normalizeQuery,
  type HistoryEntry,
  type HistoryMode,
  type RecordHistoryInput,
} from "../../shared/searchHistory.ts";

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
         strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       )
       ON CONFLICT(ownerId, mode, normalizedQuery) DO UPDATE SET
         query = excluded.query,
         resultCount = excluded.resultCount,
         resultIds = excluded.resultIds,
         fallback = excluded.fallback,
         runCount = search_history.runCount + 1,
         lastRunAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
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
    const escaped = params.q
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, "\\$&");
    filterClauses.push("AND normalizedQuery LIKE ? ESCAPE '\\'");
    filterValues.push(`%${escaped}%`);
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
  const row = sqlite
    .prepare(
      `UPDATE search_history
       SET pinned = ?
       WHERE id = ? AND ownerId = ?
       RETURNING id, ownerId, mode, query, normalizedQuery, resultCount, resultIds, fallback, pinned, runCount, createdAt, lastRunAt`,
    )
    .get(pinned ? 1 : 0, id, ownerId) as SearchHistoryRow | undefined;

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

export const searchHistoryService = {
  record,
  list,
  setPinned,
  remove,
  clear,
};
