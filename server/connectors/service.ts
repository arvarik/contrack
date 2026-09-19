/**
 * server/connectors/service.ts — Connector lifecycle, execution, and credential service.
 *
 * Owns connector CRUD, credential sealing via secretBox, inline and scheduled runs,
 * run history, backoff calculation, and audit logging.
 *
 * @module server/connectors/service
 */

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import * as secretBox from "../utils/secretBox.ts";
import { auditService } from "../services/auditService.ts";
import type {
  ConnectorDetail,
  ConnectorKind,
  ConnectorRun,
  ConnectorStatus,
  ConnectorSummary,
  Correspondent,
  RunStats,
} from "../../shared/connectors.ts";
import { getAdapter } from "./registry.ts";
import { ConnectorAuthError } from "./errors.ts";
import { buildContactMatcher } from "./matching.ts";
import { ingestStream } from "./ingest.ts";
import type { SyncContext, SyncEvent } from "./types.ts";

interface RawConnectorRow {
  id: string;
  ownerId: string;
  kind: ConnectorKind;
  name: string;
  status: ConnectorStatus;
  config: string;
  secret: string | null;
  cursor: string | null;
  intervalMinutes: number;
  attempts: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawRunRow {
  id: string;
  connectorId: string;
  ownerId: string;
  trigger: "schedule" | "manual" | "upload";
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  stats: string | null;
  error: string | null;
}

function parseRunRow(row: RawRunRow): ConnectorRun {
  return {
    id: row.id,
    connectorId: row.connectorId,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    stats: row.stats ? JSON.parse(row.stats) : null,
    error: row.error,
  };
}

function toSummary(
  row: RawConnectorRow,
  lastStats?: RunStats | null,
): ConnectorSummary {
  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(row.config || "{}");
  } catch {
    parsedConfig = {};
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    config: parsedConfig,
    secretPresent: Boolean(row.secret),
    intervalMinutes: row.intervalMinutes,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    lastRunStats: lastStats ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listConnectors(scope: Scope): ConnectorSummary[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM connectors WHERE ownerId = ? ORDER BY createdAt DESC`,
    )
    .all(scope.ownerId) as RawConnectorRow[];

  const lastRunStmt = sqlite.prepare(
    `SELECT stats FROM connector_runs
     WHERE connectorId = ? AND ownerId = ?
     ORDER BY startedAt DESC LIMIT 1`,
  );

  return rows.map((row) => {
    const lastRun = lastRunStmt.get(row.id, scope.ownerId) as
      { stats: string | null } | undefined;
    const stats = lastRun?.stats ? JSON.parse(lastRun.stats) : null;
    return toSummary(row, stats);
  });
}

export function getConnector(scope: Scope, id: string): ConnectorDetail | null {
  const row = sqlite
    .prepare(`SELECT * FROM connectors WHERE id = ? AND ownerId = ?`)
    .get(id, scope.ownerId) as RawConnectorRow | undefined;

  if (!row) return null;

  const runRows = sqlite
    .prepare(
      `SELECT * FROM connector_runs
       WHERE connectorId = ? AND ownerId = ?
       ORDER BY startedAt DESC LIMIT 5`,
    )
    .all(id, scope.ownerId) as RawRunRow[];

  const recentRuns = runRows.map(parseRunRow);
  const lastStats = recentRuns[0]?.stats ?? null;

  return {
    ...toSummary(row, lastStats),
    recentRuns,
  };
}

export async function testConnector(
  scope: Scope,
  kind: string,
  config: unknown,
  secret?: unknown,
): Promise<{ ok: true; detail: string }> {
  const adapter = getAdapter(kind as ConnectorKind);
  if (!adapter) {
    throw new AppError(`Unsupported connector kind: ${kind}`, 400);
  }

  const parsedConfig = adapter.configSchema.parse(config);
  let parsedSecret: unknown = null;
  if (adapter.secretSchema && secret !== undefined && secret !== null) {
    parsedSecret = adapter.secretSchema.parse(secret);
  }

  return adapter.test(parsedConfig, parsedSecret);
}

export async function createConnector(
  scope: Scope,
  input: {
    kind: string;
    name: string;
    config: unknown;
    secret?: unknown;
    intervalMinutes?: number;
  },
  ip: string | null = null,
): Promise<ConnectorSummary> {
  const adapter = getAdapter(input.kind as ConnectorKind);
  if (!adapter) {
    throw new AppError(`Unsupported connector kind: ${input.kind}`, 400);
  }

  const parsedConfig = adapter.configSchema.parse(input.config);
  let parsedSecret: unknown = null;
  if (
    adapter.secretSchema &&
    input.secret !== undefined &&
    input.secret !== null
  ) {
    parsedSecret = adapter.secretSchema.parse(input.secret);
  }

  // Validate credentials before saving
  await adapter.test(parsedConfig, parsedSecret);

  let sealedSecret: string | null = null;
  if (parsedSecret !== null) {
    sealedSecret = secretBox.seal(JSON.stringify(parsedSecret));
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const interval = input.intervalMinutes ?? 30;

  sqlite
    .prepare(
      `INSERT INTO connectors (
        id, ownerId, kind, name, status, config, secret, intervalMinutes, attempts, nextRunAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      id,
      scope.ownerId,
      input.kind,
      input.name.trim(),
      JSON.stringify(parsedConfig),
      sealedSecret,
      interval,
      nowIso,
      nowIso,
      nowIso,
    );

  auditService.record({
    actorUserId: scope.ownerId,
    action: "connector.created",
    targetType: "connector",
    targetId: id,
    details: { kind: input.kind, name: input.name },
    ip,
  });

  const created = getConnector(scope, id);
  if (!created) {
    throw new AppError("Failed to retrieve created connector", 500);
  }
  return created;
}

export async function updateConnector(
  scope: Scope,
  id: string,
  updates: {
    name?: string;
    config?: unknown;
    secret?: unknown;
    intervalMinutes?: number;
    status?: "active" | "paused";
  },
  ip: string | null = null,
): Promise<ConnectorSummary> {
  const existing = sqlite
    .prepare(`SELECT * FROM connectors WHERE id = ? AND ownerId = ?`)
    .get(id, scope.ownerId) as RawConnectorRow | undefined;

  if (!existing) {
    throw new AppError("Connector not found", 404);
  }

  const adapter = getAdapter(existing.kind);
  if (!adapter) {
    throw new AppError(`Unsupported connector kind: ${existing.kind}`, 400);
  }

  let nextConfig = existing.config;
  let nextSecret = existing.secret;
  let nextStatus = existing.status;
  let nextInterval = existing.intervalMinutes;
  let nextAttempts = existing.attempts;
  let nextError = existing.lastError;
  let nextRunAt = existing.nextRunAt;

  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new AppError("Name cannot be empty", 400);
  }

  if (updates.config !== undefined) {
    const parsedConfig = adapter.configSchema.parse(updates.config);
    nextConfig = JSON.stringify(parsedConfig);
  }

  if (updates.secret !== undefined && updates.secret !== null) {
    if (adapter.secretSchema) {
      const parsedSecret = adapter.secretSchema.parse(updates.secret);
      // Prove new credentials
      const currentConfig = JSON.parse(nextConfig);
      await adapter.test(currentConfig, parsedSecret);
      nextSecret = secretBox.seal(JSON.stringify(parsedSecret));

      // Reset error state if reconnected
      if (nextStatus === "needs_reauth") {
        nextStatus = "active";
        nextAttempts = 0;
        nextError = null;
        nextRunAt = new Date().toISOString();
      }
    }
  }

  if (updates.intervalMinutes !== undefined) {
    if (updates.intervalMinutes < 5) {
      throw new AppError("Interval must be at least 5 minutes", 400);
    }
    nextInterval = updates.intervalMinutes;
  }

  if (updates.status !== undefined) {
    if (updates.status === "paused") {
      nextStatus = "paused";
    } else if (updates.status === "active") {
      nextStatus = "active";
      nextAttempts = 0;
      nextRunAt = new Date().toISOString();
    }
  }

  const nowIso = new Date().toISOString();
  const nextName =
    updates.name !== undefined ? updates.name.trim() : existing.name;

  sqlite
    .prepare(
      `UPDATE connectors
       SET name = ?, config = ?, secret = ?, status = ?, intervalMinutes = ?,
           attempts = ?, nextRunAt = ?, lastError = ?, updatedAt = ?
       WHERE id = ? AND ownerId = ?`,
    )
    .run(
      nextName,
      nextConfig,
      nextSecret,
      nextStatus,
      nextInterval,
      nextAttempts,
      nextRunAt,
      nextError,
      nowIso,
      id,
      scope.ownerId,
    );

  auditService.record({
    actorUserId: scope.ownerId,
    action: "connector.updated",
    targetType: "connector",
    targetId: id,
    details: {
      name: updates.name,
      status: updates.status,
      intervalMinutes: updates.intervalMinutes,
    },
    ip,
  });

  const updated = getConnector(scope, id);
  if (!updated) {
    throw new AppError("Failed to retrieve updated connector", 500);
  }
  return updated;
}

export async function deleteConnector(
  scope: Scope,
  id: string,
  options: { deleteImported?: boolean } = {},
  ip: string | null = null,
): Promise<void> {
  const existing = sqlite
    .prepare(`SELECT * FROM connectors WHERE id = ? AND ownerId = ?`)
    .get(id, scope.ownerId) as RawConnectorRow | undefined;

  if (!existing) {
    throw new AppError("Connector not found", 404);
  }

  if (options.deleteImported) {
    // 1. Delete imported interactions
    const interactionLinks = sqlite
      .prepare(
        `SELECT localId FROM connector_links
         WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction' AND localId IS NOT NULL`,
      )
      .all(id, scope.ownerId) as Array<{ localId: string }>;

    sqlite.transaction(() => {
      const deleteIntStmt = sqlite.prepare(
        `DELETE FROM interactions WHERE id = ? AND ownerId = ?`,
      );
      for (const link of interactionLinks) {
        deleteIntStmt.run(link.localId, scope.ownerId);
      }

      // 2. Delete ghost contacts created by this connector (only if still ghosts)
      const correspondentLinks = sqlite
        .prepare(
          `SELECT localId FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND localId IS NOT NULL`,
        )
        .all(id, scope.ownerId) as Array<{ localId: string }>;

      const checkGhostStmt = sqlite.prepare(
        `SELECT id FROM contacts WHERE id = ? AND ownerId = ? AND isGhost = 1`,
      );
      const deleteContactStmt = sqlite.prepare(
        `DELETE FROM contacts WHERE id = ? AND ownerId = ?`,
      );

      for (const link of correspondentLinks) {
        const isStillGhost = checkGhostStmt.get(link.localId, scope.ownerId);
        if (isStillGhost) {
          deleteContactStmt.run(link.localId, scope.ownerId);
        }
      }
    })();
  }

  // Delete connector row (cascades connector_links, connector_runs, upcoming_events)
  sqlite
    .prepare(`DELETE FROM connectors WHERE id = ? AND ownerId = ?`)
    .run(id, scope.ownerId);

  auditService.record({
    actorUserId: scope.ownerId,
    action: "connector.deleted",
    targetType: "connector",
    targetId: id,
    details: { deleteImported: Boolean(options.deleteImported) },
    ip,
  });
}

export async function runNow(
  scope: Scope,
  id: string,
  trigger: "schedule" | "manual" | "upload" = "manual",
  explicitSignal?: AbortSignal,
): Promise<{
  runId: string;
  stats: RunStats;
  status: "ok" | "error";
  error?: string;
}> {
  const connector = sqlite
    .prepare(`SELECT * FROM connectors WHERE id = ? AND ownerId = ?`)
    .get(id, scope.ownerId) as RawConnectorRow | undefined;

  if (!connector) {
    throw new AppError("Connector not found", 404);
  }

  const runId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO connector_runs (id, connectorId, ownerId, trigger, status, startedAt)
       VALUES (?, ?, ?, ?, 'running', ?)`,
    )
    .run(runId, id, scope.ownerId, trigger, nowIso);

  const adapter = getAdapter(connector.kind);
  if (!adapter) {
    const errMsg = `Adapter not found for kind: ${connector.kind}`;
    sqlite
      .prepare(
        `UPDATE connector_runs SET status = 'error', finishedAt = ?, error = ? WHERE id = ? AND ownerId = ?`,
      )
      .run(new Date().toISOString(), errMsg, runId, scope.ownerId);
    return {
      runId,
      stats: { errors: 1 },
      status: "error",
      error: errMsg,
    };
  }

  // Parse config
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(connector.config || "{}");
  } catch (err) {
    log.error("Connectors", "Failed to parse connector config", { error: err });
  }

  // Decrypt secret if present
  let secret: unknown = null;
  if (connector.secret) {
    try {
      const opened = secretBox.open(connector.secret);
      secret = JSON.parse(opened);
    } catch (err) {
      log.error("Connectors", "Failed to decrypt connector secret", {
        error: err,
      });
      const finishIso = new Date().toISOString();
      const authErrMsg =
        "Secret encryption key is unavailable or changed. Reconnect required.";

      sqlite
        .prepare(
          `UPDATE connectors
           SET status = 'needs_reauth', lastError = ?, lastRunAt = ?, updatedAt = ?
           WHERE id = ? AND ownerId = ?`,
        )
        .run(authErrMsg, finishIso, finishIso, id, scope.ownerId);

      sqlite
        .prepare(
          `UPDATE connector_runs SET status = 'error', finishedAt = ?, error = ? WHERE id = ? AND ownerId = ?`,
        )
        .run(finishIso, authErrMsg, runId, scope.ownerId);

      auditService.record({
        actorUserId: scope.ownerId,
        action: "connector.reauth",
        targetType: "connector",
        targetId: id,
        details: { reason: "secret_unavailable" },
      });

      return {
        runId,
        stats: { errors: 1 },
        status: "error",
        error: authErrMsg,
      };
    }
  }

  // Resolve selfAddresses (owner email and any aliases configured)
  const userRow = sqlite
    .prepare(`SELECT email FROM users WHERE id = ?`)
    .get(scope.ownerId) as { email: string } | undefined;

  const selfEmails: string[] = [];
  if (userRow?.email) {
    selfEmails.push(userRow.email);
  }
  if (Array.isArray(config.selfEmails)) {
    for (const em of config.selfEmails) {
      if (typeof em === "string") selfEmails.push(em);
    }
  }

  const selfPhones: string[] = [];
  if (Array.isArray(config.selfPhones)) {
    for (const ph of config.selfPhones) {
      if (typeof ph === "string") selfPhones.push(ph);
    }
  }

  // Calculate since
  let cursor: unknown = null;
  if (connector.cursor) {
    try {
      cursor = JSON.parse(connector.cursor);
    } catch {
      cursor = null;
    }
  }

  let since: string;
  if (
    cursor &&
    typeof (cursor as { lastSyncAt?: string }).lastSyncAt === "string"
  ) {
    since = (cursor as { lastSyncAt: string }).lastSyncAt;
  } else {
    const lookbackDays = Number(config.lookbackDays ?? 90);
    since = new Date(
      Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  const signal = explicitSignal ?? new AbortController().signal;
  const ctx: SyncContext<unknown, unknown> = {
    config,
    secret,
    cursor,
    since,
    selfAddresses: { emails: selfEmails, phones: selfPhones },
    signal,
    log: (msg: string) => log.info("Connectors", `[${connector.name}] ${msg}`),
  };

  const matcher = buildContactMatcher(scope);

  try {
    const gen = adapter.sync(ctx);
    let nextCursor: unknown = null;

    // Wrap generator to capture return value (new cursor)
    const wrappedStream: AsyncIterable<SyncEvent> = {
      async *[Symbol.asyncIterator]() {
        let step = await gen.next();
        while (!step.done) {
          yield step.value;
          step = await gen.next();
        }
        nextCursor = step.value;
      },
    };

    const { stats } = await ingestStream(
      scope,
      {
        id: connector.id,
        ownerId: connector.ownerId,
        kind: connector.kind,
        config,
      },
      wrappedStream,
      matcher,
      { emails: selfEmails, phones: selfPhones },
      {
        signal,
        ghostThreshold: Number(config.ghostThreshold ?? 3),
      },
    );

    const finishIso = new Date().toISOString();
    const cursorJson =
      nextCursor !== null && nextCursor !== undefined
        ? JSON.stringify(nextCursor)
        : connector.cursor;

    const nextInterval = connector.intervalMinutes;
    const nextRun = new Date(
      Date.now() + nextInterval * 60 * 1000,
    ).toISOString();
    const newStatus =
      connector.status === "error" || connector.status === "needs_reauth"
        ? "active"
        : connector.status;

    sqlite
      .prepare(
        `UPDATE connectors
         SET status = ?, attempts = 0, lastRunAt = ?, nextRunAt = ?,
             lastError = NULL, cursor = ?, updatedAt = ?
         WHERE id = ? AND ownerId = ?`,
      )
      .run(
        newStatus,
        finishIso,
        nextRun,
        cursorJson,
        finishIso,
        id,
        scope.ownerId,
      );

    sqlite
      .prepare(
        `UPDATE connector_runs
         SET status = 'ok', finishedAt = ?, stats = ?, error = NULL
         WHERE id = ? AND ownerId = ?`,
      )
      .run(finishIso, JSON.stringify(stats), runId, scope.ownerId);

    return {
      runId,
      stats,
      status: "ok",
    };
  } catch (err: unknown) {
    const finishIso = new Date().toISOString();
    const errMsg = (err as Error).message || String(err);
    log.error(
      "Connectors",
      `Sync failed for connector ${connector.name}: ${errMsg}`,
      {
        error: err,
      },
    );

    if (
      err instanceof ConnectorAuthError ||
      err instanceof secretBox.SecretUnavailableError
    ) {
      sqlite
        .prepare(
          `UPDATE connectors
           SET status = 'needs_reauth', lastError = ?, lastRunAt = ?, updatedAt = ?
           WHERE id = ? AND ownerId = ?`,
        )
        .run(errMsg, finishIso, finishIso, id, scope.ownerId);

      auditService.record({
        actorUserId: scope.ownerId,
        action: "connector.reauth",
        targetType: "connector",
        targetId: id,
        details: { error: errMsg },
      });
    } else {
      // Exponential backoff: double interval up to 4 hours (240 minutes)
      const attempts = connector.attempts + 1;
      const backoffMultiplier = Math.pow(2, Math.min(attempts, 8));
      const backoffMinutes = Math.min(
        connector.intervalMinutes * backoffMultiplier,
        240,
      );
      const nextRun = new Date(
        Date.now() + backoffMinutes * 60 * 1000,
      ).toISOString();

      if (connector.status !== "error") {
        auditService.record({
          actorUserId: scope.ownerId,
          action: "connector.run.failed",
          targetType: "connector",
          targetId: id,
          details: { error: errMsg },
        });
      }

      sqlite
        .prepare(
          `UPDATE connectors
           SET status = 'error', attempts = ?, nextRunAt = ?, lastError = ?,
               lastRunAt = ?, updatedAt = ?
           WHERE id = ? AND ownerId = ?`,
        )
        .run(
          attempts,
          nextRun,
          errMsg,
          finishIso,
          finishIso,
          id,
          scope.ownerId,
        );
    }

    sqlite
      .prepare(
        `UPDATE connector_runs
         SET status = 'error', finishedAt = ?, error = ?
         WHERE id = ? AND ownerId = ?`,
      )
      .run(finishIso, errMsg, runId, scope.ownerId);

    return {
      runId,
      stats: { errors: 1 },
      status: "error",
      error: errMsg,
    };
  }
}

export function listRuns(
  scope: Scope,
  connectorId: string,
  limit: number = 20,
): ConnectorRun[] {
  const existing = sqlite
    .prepare(`SELECT id FROM connectors WHERE id = ? AND ownerId = ?`)
    .get(connectorId, scope.ownerId);

  if (!existing) {
    throw new AppError("Connector not found", 404);
  }

  const runRows = sqlite
    .prepare(
      `SELECT * FROM connector_runs
       WHERE connectorId = ? AND ownerId = ?
       ORDER BY startedAt DESC LIMIT ?`,
    )
    .all(connectorId, scope.ownerId, limit) as RawRunRow[];

  return runRows.map(parseRunRow);
}

export function listCorrespondents(
  scope: Scope,
  limit: number = 50,
): Correspondent[] {
  const rows = sqlite
    .prepare(
      `SELECT
         cl.connectorId,
         c.name AS connectorName,
         cl.kind,
         cl.externalId,
         cl.localId,
         cl.seenCount,
         cl.lastSeenAt,
         cl.ignoredAt
       FROM connector_links cl
       JOIN connectors c ON c.id = cl.connectorId
       WHERE cl.ownerId = ? AND cl.kind = 'correspondent'
       ORDER BY cl.seenCount DESC, cl.lastSeenAt DESC
       LIMIT ?`,
    )
    .all(scope.ownerId, limit) as Array<{
    connectorId: string;
    connectorName: string;
    kind: string;
    externalId: string;
    localId: string | null;
    seenCount: number;
    lastSeenAt: string;
    ignoredAt: string | null;
  }>;

  return rows.map((row) => {
    // Detect if externalId looks like email, phone, or name
    let email: string | undefined;
    let phone: string | undefined;
    let name: string | undefined;

    if (row.externalId.includes("@")) {
      email = row.externalId;
    } else if (/^\+?[0-9\s()-]{7,}$/.test(row.externalId)) {
      phone = row.externalId;
    } else {
      name = row.externalId;
    }

    return {
      connectorId: row.connectorId,
      connectorName: row.connectorName,
      kind: row.kind,
      externalId: row.externalId,
      email,
      phone,
      name,
      localId: row.localId,
      seenCount: row.seenCount,
      lastSeenAt: row.lastSeenAt,
      ignoredAt: row.ignoredAt,
    };
  });
}
