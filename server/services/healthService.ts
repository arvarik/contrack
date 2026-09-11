// =============================================================================
// Health Service — what an operator needs to know about one instance
// =============================================================================
// `/healthz` answers `SELECT 1`, and that is the right answer for the thing
// it is: an unauthenticated probe that must say whether the process serves
// requests and nothing else about the instance.
//
// An admin needs more when several people depend on one instance, and the
// questions they have are not "is it up". They are: did the migration run,
// is the write-ahead log growing, when was the last backup and was it any
// good, whose scan is everybody else waiting behind, is the vector index
// built for the account that just complained about search, and is the AI
// provider refusing us. Every one of those was answerable only by reading the
// server log or opening the database.
//
// Nothing here is a secret. No key, no token, no invitation link, no contact
// of anybody's. The most identifying thing in the payload is a username
// beside a queue position, and an admin can already list every account.
// =============================================================================

import fs from "fs";
import {
  OWNED_TABLES,
  VEC_VERSION,
  readTenancyVersion,
  sqlite,
  TENANCY_SCHEMA_VERSION,
} from "../db.ts";
import { ai } from "../ai/index.ts";
import { aiCache } from "../utils/aiCache.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { FTS_SCHEMA_VERSION } from "./search/ftsIndex.ts";
import { jobQueue as aiSearchQueue } from "./aiSearch/jobQueue.ts";
import { dedupeQueue } from "./dedupe/jobQueue.ts";
import { listBackups, type BackupInfo } from "./backupService.ts";
import { writeHealth, type WriteHealth } from "./walHealth.ts";

/** An account named by something other than its id. */
interface Account {
  id: string;
  username: string;
}

export interface SchemaVersions {
  /** The tenancy migration this database has reached, and the one we expect. */
  tenancy: number;
  tenancyExpected: number;
  /** The FTS schema in `PRAGMA user_version`, and the one we expect. */
  fts: number;
  ftsExpected: number;
  /** The sqlite-vec build this process loaded. */
  vec: string;
  /** False when a migration has not finished, which explains a lot of things. */
  upToDate: boolean;
}

export interface DatabaseHealth extends WriteHealth {
  /** The main database file. */
  bytes: number;
  /** Rows in each owned table, plus users. Cheap, indexed, and reassuring. */
  rows: Record<string, number>;
}

export interface QueueHealth {
  dedupe: {
    running: Account | null;
    /** Accounts waiting for the run lock, in the order they asked. */
    pending: Account[];
  };
  aiSearch: {
    running: Account | null;
    activeBatches: number;
    contactsRemaining: number;
  };
}

export interface EmbeddingProgress {
  user: Account;
  /** Active contacts this account owns. */
  contacts: number;
  /** How many of them have a search vector. */
  embedded: number;
}

export interface CacheTierHealth {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface InstanceHealth {
  /** Seconds since this process started. */
  uptimeSeconds: number;
  startedAt: string;
  schema: SchemaVersions;
  database: DatabaseHealth;
  /** The newest snapshot, or null when none has been taken. */
  backup: BackupInfo | null;
  queues: QueueHealth;
  embeddings: {
    /** False when no embedding model or provider is configured. */
    available: boolean;
    byUser: EmbeddingProgress[];
  };
  aiCache: Record<string, CacheTierHealth>;
  provider: {
    aiTier: string;
    /** Models a circuit breaker has taken out of rotation. */
    circuitBreakers: string[];
    grounding: { rpd: number; limit: number; remaining: number };
  };
}

const startedAt = new Date().toISOString();

/** Every account, by id, for putting a name next to a queue position. */
function accountsById(): Map<string, Account> {
  const rows = sqlite
    .prepare(
      // Every account on purpose: this answers an admin-only route whose
      // whole subject is the instance.
      // tenant-lint: allow instance sweep
      "SELECT id, username FROM users",
    )
    .all() as Account[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** An id the queue gave us, with the name it belongs to. */
function name(
  id: string | null,
  accounts: Map<string, Account>,
): Account | null {
  if (!id) return null;
  return accounts.get(id) ?? { id, username: "(deleted account)" };
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function rowCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of [...OWNED_TABLES, "users"]) {
    try {
      // The names come from the module constant, never from a caller.
      counts[table] = (
        sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

function schemaVersions(): SchemaVersions {
  const tenancy = readTenancyVersion();
  const fts = Number(sqlite.pragma("user_version", { simple: true }) ?? 0);
  return {
    tenancy,
    tenancyExpected: TENANCY_SCHEMA_VERSION,
    fts,
    ftsExpected: FTS_SCHEMA_VERSION,
    vec: VEC_VERSION,
    upToDate: tenancy >= TENANCY_SCHEMA_VERSION && fts >= FTS_SCHEMA_VERSION,
  };
}

/**
 * How far the search index has got, per account.
 *
 * Two numbers rather than a percentage, because the useful question is "which
 * account has contacts that search cannot reach yet" and a percentage of zero
 * contacts is not a number. Counted with the same predicate the backfill uses
 * so the two agree.
 */
function embeddingProgress(
  accounts: Map<string, Account>,
): EmbeddingProgress[] {
  const rows = sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `SELECT c.ownerId AS ownerId,
              COUNT(*) AS contacts,
              SUM(CASE WHEN e.contactId IS NULL THEN 0 ELSE 1 END) AS embedded
         FROM contacts c
         LEFT JOIN search_embeddings e ON e.contactId = c.id
        WHERE c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
          AND c.canonicalId IS NULL AND c.deletedAt IS NULL
          AND c.ownerId IS NOT NULL
        GROUP BY c.ownerId`,
    )
    .all() as { ownerId: string; contacts: number; embedded: number }[];

  return rows
    .map((row) => ({
      user: name(row.ownerId, accounts)!,
      contacts: row.contacts,
      embedded: row.embedded,
    }))
    .sort((a, b) => b.contacts - a.contacts);
}

/** The shared in-process cache, per tier, with the "batchMode" entry dropped. */
function cacheHealth(): Record<string, CacheTierHealth> {
  const out: Record<string, CacheTierHealth> = {};
  for (const [tier, stats] of Object.entries(aiCache.getStats())) {
    if (!("hits" in stats)) continue;
    const total = stats.hits + stats.misses;
    out[tier] = {
      entries: stats.entries,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: total > 0 ? Math.round((stats.hits / total) * 100) / 100 : 0,
    };
  }
  return out;
}

/**
 * Everything the admin health panel reports.
 *
 * Every part is wrapped, because a panel that answers "something threw" is
 * worse than useless: the operator opening it is already looking for a
 * problem, and a blank page is the least informative way to have one.
 */
export function instanceHealth(): InstanceHealth {
  const accounts = accountsById();
  const dedupe = dedupeQueue.instanceState();
  const search = aiSearchQueue.instanceState();

  let provider: InstanceHealth["provider"];
  try {
    const snapshot = ai.getQuotaSnapshot();
    provider = {
      aiTier: snapshot.aiTier,
      circuitBreakers: snapshot.circuitBreakers,
      grounding: snapshot.grounding,
    };
  } catch (err) {
    provider = {
      aiTier: `unavailable (${getErrorMessage(err)})`,
      circuitBreakers: [],
      grounding: { rpd: 0, limit: 0, remaining: 0 },
    };
  }

  return {
    uptimeSeconds: Math.round(process.uptime()),
    startedAt,
    schema: schemaVersions(),
    database: {
      ...writeHealth(),
      bytes: fileBytes(sqlite.name),
      rows: rowCounts(),
    },
    backup: listBackups()[0] ?? null,
    queues: {
      dedupe: {
        running: name(dedupe.running, accounts),
        pending: dedupe.pending
          .map((id) => name(id, accounts))
          .filter((account): account is Account => account !== null),
      },
      aiSearch: {
        running: name(search.running, accounts),
        activeBatches: search.activeBatches,
        contactsRemaining: search.contactsRemaining,
      },
    },
    embeddings: {
      available: ai.isConfigured || hasSearchVectors(),
      byUser: embeddingProgress(accounts),
    },
    aiCache: cacheHealth(),
    provider,
  };
}

/**
 * Whether anything has ever been embedded.
 *
 * The built-in model needs no key, so "no provider configured" does not mean
 * "no vectors". One row anywhere is enough to answer, and this is an
 * instance-wide question on an instance-wide route.
 */
function hasSearchVectors(): boolean {
  try {
    return (
      (
        sqlite
          .prepare(
            // tenant-lint: allow instance sweep
            "SELECT COUNT(*) AS n FROM search_embeddings",
          )
          .get() as { n: number }
      ).n > 0
    );
  } catch {
    return false;
  }
}
