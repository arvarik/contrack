/**
 * Connector lifecycle, runs and credentials: CRUD, credential sealing with
 * secretBox, inline and scheduled runs, run history, backoff and audit rows.
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
import { exportableContacts, toVCardInput } from "../services/exportService.ts";
import type {
  ConnectorDetail,
  ConnectorKind,
  ConnectorRun,
  ConnectorStatus,
  ConnectorSummary,
  Correspondent,
  Participant,
  RunStats,
} from "../../shared/connectors.ts";
import { getAdapter } from "./registry.ts";
import { ConnectorAuthError, ConnectorUnavailableError } from "./errors.ts";
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
  trigger: "schedule" | "manual";
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
  connectorId?: string,
): Promise<{
  ok: true;
  detail: string;
  addressBooks?: Array<{
    url: string;
    displayName: string;
    readOnly?: boolean;
  }>;
}> {
  const adapter = getAdapter(kind as ConnectorKind);
  if (!adapter) {
    throw new AppError(`Unsupported connector kind: ${kind}`, 400);
  }

  const parsedConfig = adapter.configSchema.parse(config);
  let parsedSecret: unknown = null;
  if (adapter.secretSchema && secret !== undefined && secret !== null) {
    parsedSecret = adapter.secretSchema.parse(secret);
  } else if (connectorId) {
    parsedSecret = savedSecret(
      scope,
      connectorId,
      kind,
      parsedConfig as Record<string, unknown>,
    );
  }

  return adapter.test(parsedConfig, parsedSecret, { allowFallbackBook: true });
}

/** The config fields that say where a secret goes. */
const DESTINATION_KEYS = ["host", "port", "secure", "username", "url"];

/**
 * The saved secret of one of the caller's connectors, for a test from its edit
 * form, where an empty password means "keep the saved one". Another account's
 * connector is not found, so it lends no secret. The secret goes only where it
 * went before: a test with another host, port, username or address must type it
 * again, or a stolen session could send a saved mailbox password to a server of
 * its choosing.
 */
function savedSecret(
  scope: Scope,
  id: string,
  kind: string,
  config: Record<string, unknown>,
): unknown {
  const row = sqlite
    .prepare(
      "SELECT kind, config, secret FROM connectors WHERE id = ? AND ownerId = ?",
    )
    .get(id, scope.ownerId) as
    { kind: string; config: string | null; secret: string | null } | undefined;
  if (!row || row.kind !== kind) {
    throw new AppError("Connector not found", 404, { code: "NOT_FOUND" });
  }
  if (!row.secret) return null;
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(row.config || "{}");
  } catch {
    // An unreadable config matches nothing below.
  }
  if (DESTINATION_KEYS.some((key) => saved[key] !== config[key])) {
    throw new AppError(
      "Type the password again to test a changed server or username",
      400,
      { code: "SECRET_NEEDS_REENTRY" },
    );
  }
  try {
    return JSON.parse(secretBox.open(row.secret));
  } catch {
    throw new AppError(
      "Could not read the saved password. Type it again to test",
      400,
      { code: "SECRET_UNREADABLE" },
    );
  }
}

/**
 * Waits for the adapter's check before a save. A server that is busy or down
 * for maintenance says nothing about the credentials, so the save goes ahead
 * and the refusal comes back to be saved as the connector's error.
 */
async function testBeforeSave(
  check: Promise<unknown>,
): Promise<ConnectorUnavailableError | null> {
  try {
    await check;
    return null;
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return err;
    throw err;
  }
}

/** The run time one interval from now, for a server that said "not now". */
function oneIntervalFromNow(intervalMinutes: number): string {
  return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
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
  const unavailable = await testBeforeSave(
    adapter.test(parsedConfig, parsedSecret),
  );

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
        id, ownerId, kind, name, status, config, secret, intervalMinutes, attempts, nextRunAt, lastError, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      scope.ownerId,
      input.kind,
      input.name.trim(),
      unavailable ? "error" : "active",
      JSON.stringify(parsedConfig),
      sealedSecret,
      interval,
      unavailable ? oneIntervalFromNow(interval) : nowIso,
      unavailable?.message ?? null,
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
    if (
      existing.secret &&
      (updates.secret === undefined || updates.secret === null)
    ) {
      let saved: Record<string, unknown> = {};
      try {
        saved = JSON.parse(existing.config || "{}");
      } catch {
        // An unreadable config matches nothing below.
      }
      const next = parsedConfig as Record<string, unknown>;
      if (DESTINATION_KEYS.some((key) => saved[key] !== next[key])) {
        throw new AppError(
          "Type the password again to save a changed server or username",
          400,
          { code: "SECRET_NEEDS_REENTRY" },
        );
      }
    }
    nextConfig = JSON.stringify(parsedConfig);
  }

  if (updates.secret !== undefined && updates.secret !== null) {
    if (adapter.secretSchema) {
      const parsedSecret = adapter.secretSchema.parse(updates.secret);
      // Prove new credentials
      const currentConfig = JSON.parse(nextConfig);
      const unavailable = await testBeforeSave(
        adapter.test(currentConfig, parsedSecret),
      );
      nextSecret = secretBox.seal(JSON.stringify(parsedSecret));

      if (unavailable && nextStatus !== "paused") {
        nextStatus = "error";
        nextAttempts = 0;
        nextError = unavailable.message;
        nextRunAt = oneIntervalFromNow(nextInterval);
      } else if (
        !unavailable &&
        (nextStatus === "needs_reauth" || nextStatus === "error")
      ) {
        // Reset error state if reconnected
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

/**
 * The next run after a success, as an ISO timestamp: the row's own interval
 * from now, read at the end of the run, so a change made during it counts.
 */
const NEXT_RUN_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now',
  '+' || intervalMinutes || ' minutes')`;

/**
 * The next try after a failure: the interval times the bound backoff
 * multiplier, at most four hours out.
 */
const BACKOFF_RUN_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now',
  '+' || min(intervalMinutes * ?, 240) || ' minutes')`;

/** When this process started. Runs before it belong to a process now gone. */
const PROCESS_STARTED_AT = new Date().toISOString();

/**
 * Close the runs the last process left `running`. Nothing finishes them: the
 * sync that owned each one died with its process, or ran past its deadline
 * and never returned. Called once at boot by a job, which can run after a
 * tick or a manual sync has started one of this process's own runs, so only
 * runs started before this process are closed.
 *
 * @param startedBefore - ISO time. Runs that started earlier are closed.
 * @returns how many runs were closed.
 */
export function recoverInterruptedRuns(
  startedBefore: string = PROCESS_STARTED_AT,
): number {
  return sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `UPDATE connector_runs
       SET status = 'error', finishedAt = ?, error = 'The server restarted during this sync'
       WHERE status = 'running' AND julianday(startedAt) < julianday(?)`,
    )
    .run(new Date().toISOString(), startedBefore).changes;
}

export async function runNow(
  scope: Scope,
  id: string,
  trigger: "schedule" | "manual" = "manual",
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
  } catch {
    log.error(
      "Connectors",
      `The config of connector ${connector.id} is not JSON`,
    );
  }

  // Decrypt secret if present
  let secret: unknown = null;
  if (connector.secret) {
    try {
      const opened = secretBox.open(connector.secret);
      secret = JSON.parse(opened);
    } catch (err) {
      log.error(
        "Connectors",
        `Failed to open the secret of connector ${connector.id}`,
        {
          // The parse message would quote the decrypted secret.
          error: err instanceof SyntaxError ? "The secret is not JSON" : err,
        },
      );
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

  const matcher = buildContactMatcher(scope);

  const signal = explicitSignal ?? new AbortController().signal;
  const ctx: SyncContext<unknown, unknown> = {
    config,
    secret,
    cursor,
    since,
    selfAddresses: { emails: selfEmails, phones: selfPhones },
    signal,
    log: (msg: string) => log.info("Connectors", `[${connector.id}] ${msg}`),
    accountId: scope.ownerId,
    isContactParticipant: (p: Participant) =>
      Boolean(matcher.resolveContactId(p)),
  };

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

    const { stats, ingestedContactIds } = await ingestStream(
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

    // Save the pull cursor before push starts so a push failure never loses the
    // sync token or ETags for the contacts already committed above.
    if (nextCursor !== null && nextCursor !== undefined) {
      const pullCursorIso = new Date().toISOString();
      sqlite
        .prepare(
          `UPDATE connectors SET cursor = ?, updatedAt = ? WHERE id = ? AND ownerId = ?`,
        )
        .run(JSON.stringify(nextCursor), pullCursorIso, id, scope.ownerId);
    }

    if (adapter.push) {
      const localContacts = exportableContacts(scope).map((c) => ({
        id: c.id,
        addedAt: c.addedAt ?? "",
        updatedAt: c.updatedAt ?? "",
        isArchived: Boolean(c.isArchived),
        vcardInput: toVCardInput(c),
      }));
      const rawLinks = sqlite
        .prepare(
          `SELECT externalId, localId FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND localId IS NOT NULL`,
        )
        .all(connector.id, scope.ownerId) as Array<{
        externalId: string;
        localId: string;
      }>;
      const canonicalStmt = sqlite.prepare(
        `SELECT canonicalId FROM contacts WHERE id = ? AND ownerId = ?`,
      );
      const resolveCanonicalId = (contactId: string): string => {
        let current = contactId;
        for (let depth = 0; depth < 10; depth++) {
          const row = canonicalStmt.get(current, scope.ownerId) as
            { canonicalId: string | null } | undefined;
          if (!row?.canonicalId || row.canonicalId === current) return current;
          current = row.canonicalId;
        }
        return current;
      };
      const existingLinks = rawLinks.map((link) => {
        const canonicalId = resolveCanonicalId(link.localId);
        if (canonicalId !== link.localId) {
          sqlite
            .prepare(
              `UPDATE connector_links
               SET localId = ?
               WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
            )
            .run(canonicalId, connector.id, scope.ownerId, link.externalId);
        }
        return { externalId: link.externalId, localId: canonicalId };
      });

      const pushResult = await adapter.push({
        config,
        secret,
        cursor: nextCursor ?? cursor,
        connectorCreatedAt: connector.createdAt,
        signal,
        log: ctx.log,
        contacts: localContacts,
        links: existingLinks,
        ingestedContactIds,
      });

      nextCursor = pushResult.cursor;
      if (pushResult.pushed > 0) {
        stats.pushed = (stats.pushed ?? 0) + pushResult.pushed;
      }

      const removedExternalIds = pushResult.removedExternalIds ?? [];
      if (removedExternalIds.length > 0 || pushResult.newLinks.length > 0) {
        const linkNowIso = new Date().toISOString();
        sqlite.transaction(() => {
          if (removedExternalIds.length > 0) {
            const delStmt = sqlite.prepare(
              `DELETE FROM connector_links
               WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
            );
            for (const extId of removedExternalIds) {
              delStmt.run(connector.id, scope.ownerId, extId);
            }
          }
          if (pushResult.newLinks.length > 0) {
            const upsertStmt = sqlite.prepare(
              `INSERT INTO connector_links (
                 connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
               ) VALUES (?, ?, 'contact', ?, ?, 1, ?)
               ON CONFLICT(connectorId, kind, externalId) DO UPDATE SET
                 localId = excluded.localId,
                 seenCount = seenCount + 1,
                 lastSeenAt = excluded.lastSeenAt`,
            );
            // A card the push created belongs to the source like one the
            // pull created: its source row tells ingest so, and the server's
            // later edits write over the contact.
            const sourceStmt = sqlite.prepare(
              `INSERT INTO contact_sources (id, contactId, platform, externalId, connectedOn)
               SELECT ?, ?, ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM contact_sources
                 WHERE contactId = ? AND platform = ? AND externalId = ?)`,
            );
            for (const link of pushResult.newLinks) {
              upsertStmt.run(
                connector.id,
                scope.ownerId,
                link.externalId,
                link.localId,
                linkNowIso,
              );
              sourceStmt.run(
                crypto.randomUUID(),
                link.localId,
                connector.kind,
                link.externalId,
                linkNowIso,
                link.localId,
                connector.kind,
                link.externalId,
              );
            }
          }
        })();
      }
    }

    const finishIso = new Date().toISOString();
    const cursorJson =
      nextCursor !== null && nextCursor !== undefined
        ? JSON.stringify(nextCursor)
        : connector.cursor;

    // The status and the interval are read again here, not from the row the
    // run started with: a pause set during the run stays, and a new interval
    // sets the next run. A failed connector is active again.
    sqlite
      .prepare(
        `UPDATE connectors
         SET status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END,
             attempts = 0, lastRunAt = ?,
             nextRunAt = ${NEXT_RUN_SQL},
             lastError = NULL, cursor = ?, updatedAt = ?
         WHERE id = ? AND ownerId = ?`,
      )
      .run(finishIso, cursorJson, finishIso, id, scope.ownerId);

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
      `Sync failed for connector ${connector.id}: ${errMsg}`,
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
      // Exponential backoff: double the interval, up to 4 hours. The
      // scheduler retries a connector in 'error' once nextRunAt passes.
      const attempts = connector.attempts + 1;
      const backoffMultiplier = Math.pow(2, Math.min(attempts, 8));

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
           SET status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'error' END,
               attempts = ?, nextRunAt = ${BACKOFF_RUN_SQL}, lastError = ?,
               lastRunAt = ?, updatedAt = ?
           WHERE id = ? AND ownerId = ?`,
        )
        .run(
          attempts,
          backoffMultiplier,
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
  const sql = `SELECT
         cl.connectorId,
         c.name AS connectorName,
         cl.kind,
         cl.externalId,
         cl.localId,
         cl.seenCount,
         cl.lastSeenAt,
         cl.ignoredAt,
         cl.displayName
       FROM connector_links cl
       JOIN connectors c ON c.id = cl.connectorId
        WHERE cl.ownerId = ? AND cl.kind = 'correspondent' AND cl.ignoredAt IS NULL AND cl.localId IS NULL
          AND cl.externalId NOT IN (
            SELECT LOWER(ce.email)
            FROM contact_emails ce
            JOIN contacts c2 ON c2.id = ce.contactId
            WHERE c2.ownerId = cl.ownerId AND c2.deletedAt IS NULL
          )
        ORDER BY cl.seenCount DESC, cl.lastSeenAt DESC
        LIMIT ?`;

  const rows = sqlite.prepare(sql).all(scope.ownerId, limit) as Array<{
    connectorId: string;
    connectorName: string;
    kind: string;
    externalId: string;
    localId: string | null;
    seenCount: number;
    lastSeenAt: string;
    ignoredAt: string | null;
    displayName: string | null;
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
      // The name the mail or meeting gave, or the name the link is keyed by.
      name: row.displayName ?? name,
      localId: row.localId,
      seenCount: row.seenCount,
      lastSeenAt: row.lastSeenAt,
      ignoredAt: row.ignoredAt,
    };
  });
}

/**
 * Sets ignoredAt on a correspondent link so it no longer appears in review or becomes a ghost.
 */
export function ignoreCorrespondent(
  scope: Scope,
  connectorId: string,
  externalId: string,
): boolean {
  const result = sqlite
    .prepare(
      `UPDATE connector_links
       SET ignoredAt = CURRENT_TIMESTAMP
       WHERE connectorId = ? AND kind = 'correspondent' AND externalId = ? AND ownerId = ?`,
    )
    .run(connectorId, externalId, scope.ownerId);

  return result.changes > 0;
}
