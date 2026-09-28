/**
 * server/connectors/ingest.ts — Event ingestion engine for Contrack connectors.
 *
 * Consumes SyncEvents yielded by adapters:
 * 1. Matches participants to contacts via ContactMatcher.
 * 2. Deduplicates by externalId using connector_links.
 * 3. Supports day roll-up by contactId:YYYY-MM-DD.
 * 4. Counts unknown participants as correspondents; promotes to ghost contacts
 *    when crossing ghostThreshold.
 * 5. Refreshes upcoming_events, replacing stale rows.
 * 6. Commits in transactions of 100 events.
 * 7. Copies each contact photo to the owner's uploads before the event is
 *    queued, so a contact never stores a third-party image URL.
 *
 * @module server/connectors/ingest
 */
import crypto from "node:crypto";
import path from "node:path";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { interactionService } from "../services/interactionService.ts";
import { contactService } from "../services/contactService.ts";
import type { NewContactPayload } from "../repositories/types.ts";
import { normalizePhone } from "../utils/nlp/phone.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { ownerUploadDir, ownerUploadUrl } from "../utils/paths.ts";
import {
  ensureLocalImage,
  imageHost,
  isTransientImageError,
  urlDigest,
} from "../utils/remoteImage.ts";
import type { ContactMatcher } from "./matching.ts";
import type { SyncEvent } from "./types.ts";
import type { ConnectorKind, RunStats } from "../../shared/connectors.ts";

export interface IngestOptions {
  ghostThreshold?: number;
  batchSize?: number; // default 100
  signal?: AbortSignal;
  onProgress?: (stats: RunStats) => void;
}

export interface ConnectorInfo {
  id: string;
  ownerId: string;
  kind: ConnectorKind;
  config: Record<string, unknown>;
}

export interface IngestResult {
  stats: RunStats;
}

/** Contact avatars: 256 px square, the size processBase64Avatar writes. */
const PHOTO_SIZE = 256;
const PHOTO_JPEG_QUALITY = 80;
/** A contact photo is tens of kilobytes. The cap refuses anything else. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 8_000;
/**
 * Photo downloads in flight at once. A first sync can carry thousands of
 * photos, and one at a time would add minutes to it. A few at a time keeps
 * the sync quick without a burst of requests to one host.
 */
const PHOTO_CONCURRENCY = 6;

/**
 * Run at most `limit` tasks at once. A finished task hands its slot straight
 * to the next waiting one, so the count never passes the limit.
 */
function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Copy a connector's contact photo into the owner's avatars folder, and
 * return the local URL.
 *
 * Google's photo URLs point at googleusercontent.com, and a browser that
 * loads one tells Google each time somebody opens the contact. The copy is
 * re-encoded the way processBase64Avatar does it: 256 px cover JPEG.
 *
 * The file name is the digest of the remote URL. Every sync sends the same
 * URL for an unchanged photo, so an existing file is reused with no network
 * call, and a changed photo gets a new URL and so a new file.
 *
 * Throws RemoteImageError (see isTransientImageError) or the caller's abort.
 */
export async function saveContactPhoto(
  scope: Scope,
  remoteUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const filename = `remote-${urlDigest(remoteUrl)}.jpg`;
  const outPath = path.join(ownerUploadDir(scope.ownerId, "avatars"), filename);
  await ensureLocalImage(
    remoteUrl,
    outPath,
    (img) =>
      img
        .rotate()
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true }),
    { maxBytes: PHOTO_MAX_BYTES, timeoutMs: PHOTO_TIMEOUT_MS, signal },
  );
  return ownerUploadUrl(scope.ownerId, "avatars", filename);
}

/**
 * `saveContactPhoto` for a sync: the local URL, or undefined when there is no
 * usable copy, and the contact keeps the avatar it has. The one exception is
 * the sync's own abort, which is rethrown so the run stops.
 */
async function localContactPhoto(
  scope: Scope,
  remoteUrl: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await saveContactPhoto(scope, remoteUrl, signal);
  } catch (err) {
    signal?.throwIfAborted();
    // The host only: a photo URL carries an access token in its path.
    const detail = `Contact photo from ${imageHost(remoteUrl)} was not saved: ${getErrorMessage(err)}`;
    if (isTransientImageError(err)) log.warn("Connectors", detail);
    else log.debug("Connectors", detail);
    return undefined;
  }
}

/**
 * Ingests a stream of SyncEvents from an adapter.
 */
export async function ingestStream(
  scope: Scope,
  connector: ConnectorInfo,
  stream: AsyncIterable<SyncEvent>,
  matcher: ContactMatcher,
  selfAddresses: { emails: string[]; phones: string[] },
  options: IngestOptions = {},
): Promise<IngestResult> {
  const batchSize = options.batchSize ?? 100;
  const ghostThreshold =
    options.ghostThreshold ?? Number(connector.config.ghostThreshold ?? 3);
  const signal = options.signal;

  const stats: RunStats = {
    fetched: 0,
    interactions: 0,
    meetings: 0,
    messages: 0,
    emails: 0,
    upcoming: 0,
    contacts: 0,
    ghosts: 0,
    correspondents: 0,
    skipped: 0,
    errors: 0,
  };

  const seenUpcomingExternalIds = new Set<string>();
  let hasUpcomingEvents = false;

  function processSingleEvent(event: SyncEvent, nowIso: string): void {
    if (event.kind === "progress") {
      stats.fetched = event.fetched;
      return;
    }

    stats.fetched = (stats.fetched ?? 0) + 1;

    if (event.kind === "upcoming") {
      hasUpcomingEvents = true;
      seenUpcomingExternalIds.add(event.externalId);

      const match = matcher.matchParticipants(
        event.participants,
        selfAddresses,
      );
      const contactIds = match.primaryContactId
        ? [match.primaryContactId, ...match.mentionContactIds]
        : [];

      sqlite
        .prepare(
          `INSERT INTO upcoming_events (
            connectorId, ownerId, externalId, title, startsAt, endsAt, participants, contactIds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connectorId, externalId) DO UPDATE SET
            title = excluded.title,
            startsAt = excluded.startsAt,
            endsAt = excluded.endsAt,
            participants = excluded.participants,
            contactIds = excluded.contactIds`,
        )
        .run(
          connector.id,
          scope.ownerId,
          event.externalId,
          event.title,
          event.startsAt,
          event.endsAt,
          JSON.stringify(event.participants),
          JSON.stringify(contactIds),
        );

      stats.upcoming = (stats.upcoming ?? 0) + 1;
      return;
    }

    if (event.kind === "interaction") {
      // 1. Check idempotency via connector_links
      const existingLink = sqlite
        .prepare(
          `SELECT localId, seenCount
           FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction' AND externalId = ?`,
        )
        .get(connector.id, scope.ownerId, event.externalId) as
        { localId: string | null; seenCount: number } | undefined;

      if (existingLink) {
        sqlite
          .prepare(
            `UPDATE connector_links
             SET seenCount = seenCount + 1, lastSeenAt = ?
             WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction' AND externalId = ?`,
          )
          .run(nowIso, connector.id, scope.ownerId, event.externalId);
        stats.skipped = (stats.skipped ?? 0) + 1;
        return;
      }

      // 2. Match participants
      const match = matcher.matchParticipants(
        event.participants,
        selfAddresses,
      );

      if (match.primaryContactId) {
        const isEmailOrMessage =
          event.type === "email" || event.type === "message";
        const doRollup =
          connector.config.rollup !== false &&
          connector.config.granularity !== "message";
        const dateStr = event.date
          ? event.date.slice(0, 10)
          : nowIso.slice(0, 10);
        const rollupKey =
          (event as { rollupKey?: string }).rollupKey ??
          (isEmailOrMessage && doRollup
            ? `${match.primaryContactId}:${dateStr}`
            : undefined);

        if (rollupKey) {
          const rollupRow = sqlite
            .prepare(
              `SELECT localId, seenCount
               FROM connector_links
               WHERE connectorId = ? AND ownerId = ? AND kind = 'rollup' AND externalId = ?`,
            )
            .get(connector.id, scope.ownerId, rollupKey) as
            { localId: string | null; seenCount: number } | undefined;

          if (rollupRow && rollupRow.localId) {
            // Rollup exists: update the existing day interaction
            const existingId = rollupRow.localId;
            const newSeenCount = (rollupRow.seenCount ?? 1) + 1;
            const contactRow = sqlite
              .prepare(`SELECT name FROM contacts WHERE id = ? AND ownerId = ?`)
              .get(match.primaryContactId, scope.ownerId) as
              { name: string } | undefined;
            const contactName = contactRow?.name;
            const typeLabel = event.type === "email" ? "emails" : "messages";
            const updatedTitle = contactName
              ? `${newSeenCount} ${typeLabel} with ${contactName}`
              : `${newSeenCount} ${typeLabel}`;

            const appendContent = event.content
              ? `\n\n---\n\n${event.content}`
              : "";
            sqlite
              .prepare(
                `UPDATE interactions
                 SET title = ?,
                     content = CASE
                   WHEN content IS NULL OR content = '' THEN ?
                   ELSE content || ?
                 END,
                 updatedAt = ?
                 WHERE id = ? AND ownerId = ?`,
              )
              .run(
                updatedTitle,
                event.content ?? "",
                appendContent,
                nowIso,
                existingId,
                scope.ownerId,
              );

            // Record link for this specific message pointing to the rollup interaction
            sqlite
              .prepare(
                `INSERT INTO connector_links (
                  connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
                ) VALUES (?, ?, 'interaction', ?, ?, 1, ?)`,
              )
              .run(
                connector.id,
                scope.ownerId,
                event.externalId,
                existingId,
                nowIso,
              );

            sqlite
              .prepare(
                `UPDATE connector_links
                 SET seenCount = ?, lastSeenAt = ?
                 WHERE connectorId = ? AND ownerId = ? AND kind = 'rollup' AND externalId = ?`,
              )
              .run(
                newSeenCount,
                nowIso,
                connector.id,
                scope.ownerId,
                rollupKey,
              );

            if (event.type === "meeting" || connector.kind === "ics") {
              stats.meetings = (stats.meetings ?? 0) + 1;
            } else if (event.type === "message") {
              stats.messages = (stats.messages ?? 0) + 1;
            } else if (event.type === "email" || connector.kind === "imap") {
              stats.emails = (stats.emails ?? 0) + 1;
            }
            stats.interactions = (stats.interactions ?? 0) + 1;
            return;
          }
        }

        // Create new interaction
        const interaction = interactionService.createInteraction(
          scope,
          match.primaryContactId,
          {
            type: event.type,
            title: event.title,
            content: event.content || null,
            date: event.date,
            source: connector.kind,
            skipMentions: true,
          },
        );

        // Insert interaction link
        sqlite
          .prepare(
            `INSERT INTO connector_links (
              connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
            ) VALUES (?, ?, 'interaction', ?, ?, 1, ?)`,
          )
          .run(
            connector.id,
            scope.ownerId,
            event.externalId,
            interaction.id,
            nowIso,
          );

        // If rollup requested, insert rollup link
        if (rollupKey) {
          sqlite
            .prepare(
              `INSERT INTO connector_links (
                connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
              ) VALUES (?, ?, 'rollup', ?, ?, 1, ?)`,
            )
            .run(
              connector.id,
              scope.ownerId,
              rollupKey,
              interaction.id,
              nowIso,
            );
        }

        // Insert mentions
        for (const mentionId of match.mentionContactIds) {
          sqlite
            .prepare(
              `INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId)
               VALUES (?, ?)`,
            )
            .run(interaction.id, mentionId);
        }

        if (event.type === "meeting" || connector.kind === "ics") {
          stats.meetings = (stats.meetings ?? 0) + 1;
        } else if (event.type === "message") {
          stats.messages = (stats.messages ?? 0) + 1;
        } else if (event.type === "email" || connector.kind === "imap") {
          stats.emails = (stats.emails ?? 0) + 1;
        }
        stats.interactions = (stats.interactions ?? 0) + 1;
      } else {
        // No contact matched: handle unknown participants
        for (const p of match.unknownParticipants) {
          const rawId =
            p.email?.toLowerCase().trim() ||
            (p.phone ? normalizePhone(p.phone) : null) ||
            p.name?.trim();

          if (!rawId) continue;
          const externalId = rawId;

          const row = sqlite
            .prepare(
              `SELECT localId, seenCount, ignoredAt
               FROM connector_links
               WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND externalId = ?`,
            )
            .get(connector.id, scope.ownerId, externalId) as
            | {
                localId: string | null;
                seenCount: number;
                ignoredAt: string | null;
              }
            | undefined;

          if (row) {
            const newSeen = row.seenCount + 1;
            sqlite
              .prepare(
                `UPDATE connector_links
                 SET seenCount = ?, lastSeenAt = ?
                 WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND externalId = ?`,
              )
              .run(newSeen, nowIso, connector.id, scope.ownerId, externalId);

            if (!row.ignoredAt && !row.localId) {
              if (newSeen >= ghostThreshold) {
                // Promote to ghost contact
                const ghostId = crypto.randomUUID();
                // A vibe id the client draws (`VIBES` in src/lib/theme.ts).
                const newTheme = ["brand", "teal", "rose", "emerald", "amber"][
                  Math.floor(Math.random() * 5)
                ];
                const ghostName = p.name || p.email || p.phone || "Unknown";

                sqlite
                  .prepare(
                    `INSERT INTO contacts (id, ownerId, name, isGhost, themeColor, addedAt, updatedAt)
                     VALUES (?, ?, ?, 1, ?, ?, ?)`,
                  )
                  .run(
                    ghostId,
                    scope.ownerId,
                    ghostName,
                    newTheme,
                    nowIso,
                    nowIso,
                  );

                if (p.email) {
                  sqlite
                    .prepare(
                      `INSERT INTO contact_emails (id, contactId, email, isPrimary)
                       VALUES (?, ?, ?, 1)`,
                    )
                    .run(
                      crypto.randomUUID(),
                      ghostId,
                      p.email.toLowerCase().trim(),
                    );
                }
                if (p.phone) {
                  sqlite
                    .prepare(
                      `INSERT INTO contact_phones (id, contactId, phone, isPrimary)
                       VALUES (?, ?, ?, 1)`,
                    )
                    .run(crypto.randomUUID(), ghostId, normalizePhone(p.phone));
                }

                sqlite
                  .prepare(
                    `UPDATE connector_links
                     SET localId = ?
                     WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND externalId = ?`,
                  )
                  .run(ghostId, connector.id, scope.ownerId, externalId);

                matcher.registerContact(
                  ghostId,
                  p.email ? [p.email] : [],
                  p.phone ? [p.phone] : [],
                );
                stats.ghosts = (stats.ghosts ?? 0) + 1;
              }
            }
          } else {
            // First time seen
            if (ghostThreshold <= 1) {
              const ghostId = crypto.randomUUID();
              const newTheme = ["brand", "teal", "rose", "emerald", "amber"][
                Math.floor(Math.random() * 5)
              ];
              const ghostName = p.name || p.email || p.phone || "Unknown";

              sqlite
                .prepare(
                  `INSERT INTO contacts (id, ownerId, name, isGhost, themeColor, addedAt, updatedAt)
                   VALUES (?, ?, ?, 1, ?, ?, ?)`,
                )
                .run(
                  ghostId,
                  scope.ownerId,
                  ghostName,
                  newTheme,
                  nowIso,
                  nowIso,
                );

              if (p.email) {
                sqlite
                  .prepare(
                    `INSERT INTO contact_emails (id, contactId, email, isPrimary)
                     VALUES (?, ?, ?, 1)`,
                  )
                  .run(
                    crypto.randomUUID(),
                    ghostId,
                    p.email.toLowerCase().trim(),
                  );
              }
              if (p.phone) {
                sqlite
                  .prepare(
                    `INSERT INTO contact_phones (id, contactId, phone, isPrimary)
                     VALUES (?, ?, ?, 1)`,
                  )
                  .run(crypto.randomUUID(), ghostId, normalizePhone(p.phone));
              }

              sqlite
                .prepare(
                  `INSERT INTO connector_links (
                    connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
                  ) VALUES (?, ?, 'correspondent', ?, ?, 1, ?)`,
                )
                .run(connector.id, scope.ownerId, externalId, ghostId, nowIso);

              matcher.registerContact(
                ghostId,
                p.email ? [p.email] : [],
                p.phone ? [p.phone] : [],
              );
              stats.ghosts = (stats.ghosts ?? 0) + 1;
            } else {
              sqlite
                .prepare(
                  `INSERT INTO connector_links (
                    connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
                  ) VALUES (?, ?, 'correspondent', ?, NULL, 1, ?)`,
                )
                .run(connector.id, scope.ownerId, externalId, nowIso);
              stats.correspondents = (stats.correspondents ?? 0) + 1;
            }
          }
        }
      }
      return;
    }

    if (event.kind === "contact") {
      const existingLink = sqlite
        .prepare(
          `SELECT localId
           FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
        )
        .get(connector.id, scope.ownerId, event.externalId) as
        { localId: string | null } | undefined;

      const cPayload = { ...(event.contact as unknown as NewContactPayload) };
      const cEmails: string[] = Array.isArray(cPayload.emails)
        ? cPayload.emails
            .map((e: unknown) =>
              typeof e === "string" ? e : (e as { email?: string })?.email,
            )
            .filter((e): e is string => typeof e === "string" && Boolean(e))
        : [];
      const cPhones: string[] = Array.isArray(cPayload.phones)
        ? cPayload.phones
            .map((p: unknown) =>
              typeof p === "string" ? p : (p as { phone?: string })?.phone,
            )
            .filter((p): p is string => typeof p === "string" && Boolean(p))
        : [];

      // By now photoUrl is the local copy the stream loop made, or absent.
      // The prefix check is a second guard: a remote URL is never stored.
      if (
        event.photoUrl &&
        event.photoUrl.startsWith("/uploads/") &&
        !cPayload.avatarUrl
      ) {
        cPayload.avatarUrl = event.photoUrl;
      }

      if (existingLink && existingLink.localId) {
        try {
          contactService.updateContact(scope, existingLink.localId, cPayload);
        } catch {
          // ignore if contact was removed or update failed
        }
        sqlite
          .prepare(
            `UPDATE connector_links
             SET seenCount = seenCount + 1, lastSeenAt = ?
             WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
          )
          .run(nowIso, connector.id, scope.ownerId, event.externalId);
      } else {
        let matchedContactId: string | null = null;
        for (const em of cEmails) {
          matchedContactId = matcher.resolveContactId({ email: em });
          if (matchedContactId) break;
        }
        if (!matchedContactId) {
          for (const ph of cPhones) {
            matchedContactId = matcher.resolveContactId({ phone: ph });
            if (matchedContactId) break;
          }
        }

        let contactId = matchedContactId;
        if (!contactId) {
          if (!cPayload.name) {
            cPayload.name = cEmails[0] || cPhones[0] || "Unknown";
          }
          cPayload.sources = [
            {
              platform: connector.kind,
              externalId: event.externalId,
              connectedOn: nowIso,
            },
          ];
          const created = contactService.createContact(
            scope,
            cPayload,
            connector.kind,
          );
          if (created) {
            contactId = created.id;
          }
        }

        if (contactId) {
          matcher.registerContact(contactId, cEmails, cPhones);

          if (existingLink) {
            sqlite
              .prepare(
                `UPDATE connector_links
                 SET localId = ?, seenCount = seenCount + 1, lastSeenAt = ?
                 WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
              )
              .run(
                contactId,
                nowIso,
                connector.id,
                scope.ownerId,
                event.externalId,
              );
          } else {
            sqlite
              .prepare(
                `INSERT INTO connector_links (
                  connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
                ) VALUES (?, ?, 'contact', ?, ?, 1, ?)`,
              )
              .run(
                connector.id,
                scope.ownerId,
                event.externalId,
                contactId,
                nowIso,
              );
          }
        }
      }
      stats.contacts = (stats.contacts ?? 0) + 1;
    }
  }

  // Process stream in batches of `batchSize` per transaction.
  //
  // The photo download is async and the batch transaction is synchronous, so
  // the copy is made before the event joins a batch. A contact event with a
  // photo enters the batch as a promise of the same event carrying the local
  // URL, or no photo at all. The batch waits for all of them before its
  // transaction opens, so the transaction never sees a remote URL, and the
  // events keep the order the adapter sent them in.
  const photoSlot = createLimiter(PHOTO_CONCURRENCY);
  let batch: Array<SyncEvent | Promise<SyncEvent>> = [];

  for await (const event of stream) {
    signal?.throwIfAborted();
    if (event.kind === "contact" && event.photoUrl) {
      const remoteUrl = event.photoUrl;
      const ready = photoSlot(async (): Promise<SyncEvent> => ({
        ...event,
        photoUrl: await localContactPhoto(scope, remoteUrl, signal),
      }));
      // Only an abort rejects, and Promise.all below reports it. This handler
      // keeps a rejection that lands before the batch is awaited from being
      // reported as unhandled, which would stop the process.
      ready.catch(() => undefined);
      batch.push(ready);
    } else {
      batch.push(event);
    }

    if (batch.length >= batchSize) {
      const pending = batch;
      batch = [];
      const currentBatch = await Promise.all(pending);
      signal?.throwIfAborted();
      const nowIso = new Date().toISOString();
      sqlite.transaction(() => {
        for (const ev of currentBatch) {
          processSingleEvent(ev, nowIso);
        }
      })();
      options.onProgress?.(stats);
    }
  }

  if (batch.length > 0) {
    const pending = batch;
    batch = [];
    const currentBatch = await Promise.all(pending);
    signal?.throwIfAborted();
    const nowIso = new Date().toISOString();
    sqlite.transaction(() => {
      for (const ev of currentBatch) {
        processSingleEvent(ev, nowIso);
      }
    })();
  }

  // Refresh upcoming events: remove stale upcoming events for this connector
  if (
    hasUpcomingEvents ||
    connector.kind === "ics" ||
    connector.kind === "google"
  ) {
    sqlite.transaction(() => {
      if (seenUpcomingExternalIds.size === 0) {
        sqlite
          .prepare(
            `DELETE FROM upcoming_events WHERE connectorId = ? AND ownerId = ?`,
          )
          .run(connector.id, scope.ownerId);
      } else {
        const placeholders = Array.from(seenUpcomingExternalIds)
          .map(() => "?")
          .join(",");
        sqlite
          .prepare(
            `DELETE FROM upcoming_events
             WHERE connectorId = ? AND ownerId = ? AND externalId NOT IN (${placeholders})`,
          )
          .run(
            connector.id,
            scope.ownerId,
            ...Array.from(seenUpcomingExternalIds),
          );
      }
    })();
  }

  options.onProgress?.(stats);
  return { stats };
}
