/**
 * Event ingestion for connectors. It consumes the SyncEvents adapters yield:
 * 1. Matches participants to contacts (ContactMatcher).
 * 2. Deduplicates by externalId through connector_links.
 * 3. Rolls a day up by contactId:YYYY-MM-DD.
 * 4. Counts unknown participants as correspondents, and promotes them to ghost
 *    contacts past ghostThreshold. A no-reply sender and a broadcast to many
 *    strangers count nobody.
 * 5. Writes a synced person over the contact the sync made for it, and only
 *    fills in a contact the sync linked by a shared address. Trashes the
 *    former when its source deletes it, and unlinks the latter.
 * 6. Refreshes upcoming_events, replacing stale rows.
 * 7. Commits in transactions of 100 events.
 * 8. Copies each contact photo to the owner's uploads before the event is
 *    queued, so a contact never stores a third-party image URL.
 *
 * @module server/connectors/ingest
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { interactionService } from "../services/interactionService.ts";
import { contactService } from "../services/contactService.ts";
import type { ContactPayload, HydratedContact } from "../repositories/types.ts";
import { doubleMetaphone, normalizePhone } from "../utils/nlp/index.ts";
import { dispatchEvents, recordEvent } from "../events/index.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage, newContactId } from "../utils/helpers.ts";
import { ownerUploadDir, ownerUploadUrl } from "../utils/paths.ts";
import {
  isBase64DataUri,
  processBase64Avatar,
} from "../utils/avatarProcessor.ts";
import {
  ensureLocalImage,
  imageHost,
  isTransientImageError,
  urlDigest,
} from "../utils/remoteImage.ts";
import type { ContactMatcher } from "./matching.ts";
import type { SyncEvent } from "./types.ts";
import type {
  ConnectorKind,
  Participant,
  RunStats,
} from "../../shared/connectors.ts";

export interface IngestOptions {
  ghostThreshold?: number;
  signal?: AbortSignal;
}

export interface ConnectorInfo {
  id: string;
  ownerId: string;
  kind: ConnectorKind;
  config: Record<string, unknown>;
}

export interface IngestResult {
  stats: RunStats;
  ingestedContactIds: Set<string>;
}

/** Events committed in one transaction. */
const BATCH_SIZE = 100;

/**
 * The name a mail or a meeting gave a participant, such as "Rowan Vale" in
 * "Rowan Vale <rowan@example.com>", or null when it gave only the address.
 */
function givenName(p: Participant): string | null {
  const name = p.name?.trim();
  if (!name) return null;
  const same = (value?: string) =>
    value?.trim().toLowerCase() === name.toLowerCase();
  return same(p.email) || same(p.phone) ? null : name;
}

/**
 * Addresses no person reads. A mail from one is a notification, so its sender
 * is not a correspondent and never a suggested contact.
 */
const BULK_SENDER =
  /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?)([@+._-]|$)/i;
/**
 * A mail or a meeting with more strangers than this is a broadcast, not a
 * conversation: it counts none of them. The calendar's own attendee cap is 25.
 */
const MAX_STRANGERS_PER_EVENT = 25;

/** The address an email or a phone entry of a payload names. */
function payloadValue(
  entry: unknown,
  key: "email" | "phone",
): string | undefined {
  if (typeof entry === "string") return entry;
  const value = (entry as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * What a sync may write to a contact it did not make: a field the contact
 * leaves empty, and an email or a phone it does not have. Null when there is
 * nothing to add. The sync never renames the contact or drops its addresses,
 * so a second Google card that shares one address cannot turn "Mom" into "Dad".
 */
export function fillFromRemote(
  local: HydratedContact,
  remote: ContactPayload,
): ContactPayload | null {
  const out: ContactPayload = {};
  for (const [key, value] of Object.entries(remote)) {
    if (key === "emails" || key === "phones" || key === "sources") continue;
    if (value == null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const current = (local as unknown as Record<string, unknown>)[key];
    const empty =
      current == null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (empty) out[key] = value;
  }
  const emails = new Set(local.emails.map((e) => e.email.toLowerCase()));
  const newEmails = (remote.emails ?? []).filter((e) => {
    const address = payloadValue(e, "email")?.toLowerCase().trim();
    return address && !emails.has(address) && emails.add(address);
  });
  if (newEmails.length > 0) {
    out.emails = [
      ...local.emails.map(({ email, label, isPrimary }) => ({
        email,
        label: label ?? undefined,
        isPrimary,
      })),
      ...newEmails.map((e) => ({
        ...(typeof e === "string" ? { email: e } : e),
        isPrimary: false,
      })),
    ];
  }
  const phones = new Set(local.phones.map((p) => normalizePhone(p.phone)));
  const newPhones = (remote.phones ?? []).filter((p) => {
    const number = payloadValue(p, "phone");
    const normalized = number ? normalizePhone(number) : "";
    return normalized && !phones.has(normalized) && phones.add(normalized);
  });
  if (newPhones.length > 0) {
    out.phones = [
      ...local.phones.map(({ phone, label, isPrimary }) => ({
        phone,
        label: label ?? undefined,
        isPrimary,
      })),
      ...newPhones.map((p) => ({
        ...(typeof p === "string" ? { phone: p } : p),
        isPrimary: false,
      })),
    ];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Contact avatars: 256 px square, the size processBase64Avatar writes. */
const PHOTO_SIZE = 256;
const PHOTO_JPEG_QUALITY = 80;
/** A contact photo is tens of kilobytes. The cap refuses anything else. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 8_000;
/**
 * Photo downloads in flight at once. A first sync can carry thousands of
 * photos: one at a time adds minutes, and a few at a time avoids a burst at one
 * host.
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
 * Copy a connector's contact photo into the owner's avatars folder and return
 * the local URL. A browser that loads a googleusercontent.com URL tells Google
 * each time somebody opens the contact. The copy is re-encoded like
 * processBase64Avatar: a 256 px cover JPEG. The file name is the digest of the
 * remote URL: an unchanged photo keeps its URL, so its file is reused with no
 * network call, and a changed photo gets a new file.
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
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "center" })
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
  if (isBase64DataUri(remoteUrl)) {
    return (await processBase64Avatar(scope, remoteUrl)) ?? undefined;
  }
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
 * The longest title, note and participant name a connector stores. A mail
 * server or a calendar feed writes them, not the person, and a 5 MB feed can
 * hold one event title of 5 MB.
 */
export const MAX_SYNCED_TITLE = 300;
export const MAX_SYNCED_CONTENT = 20_000;
const MAX_SYNCED_NAME = 200;

function capped(event: SyncEvent): SyncEvent {
  if (event.kind !== "interaction" && event.kind !== "upcoming") return event;
  const participants = event.participants.map((p) =>
    p.name && p.name.length > MAX_SYNCED_NAME
      ? { ...p, name: p.name.slice(0, MAX_SYNCED_NAME) }
      : p,
  );
  const title = event.title.slice(0, MAX_SYNCED_TITLE);
  if (event.kind === "upcoming") return { ...event, title, participants };
  return {
    ...event,
    title,
    participants,
    content: event.content?.slice(0, MAX_SYNCED_CONTENT),
  };
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
  const ingestedContactIds = new Set<string>();
  let hasUpcomingEvents = false;

  /**
   * Whether the sync made this contact for this external id: its source row
   * names the connector's kind and the id. Then the source owns its details.
   */
  function madeBySync(contactId: string, externalId: string): boolean {
    return Boolean(
      sqlite
        .prepare(
          `SELECT 1 FROM contact_sources WHERE contactId = ? AND platform = ? AND externalId = ?`,
        )
        .get(contactId, connector.kind, externalId),
    );
  }

  /**
   * A ghost contact for a stranger seen often enough, with the address the
   * mail or meeting gave. Recorded like every created contact, so the search
   * index, the duplicate check and the score see it. Runs inside the batch
   * transaction, as recordEvent requires.
   */
  function createGhost(p: Participant, nowIso: string): string {
    const ghostName = p.name || p.email || p.phone || "Unknown";
    const ghostId = newContactId(ghostName);
    // A vibe id the client draws (`VIBES` in src/lib/theme.ts).
    const newTheme = ["brand", "teal", "rose", "emerald", "amber"][
      Math.floor(Math.random() * 5)
    ];
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, isGhost, themeColor, phoneticHash, addedAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        ghostId,
        scope.ownerId,
        ghostName,
        newTheme,
        doubleMetaphone(ghostName).primary,
        nowIso,
        nowIso,
      );
    if (p.email) {
      sqlite
        .prepare(
          `INSERT INTO contact_emails (id, contactId, email, isPrimary)
           VALUES (?, ?, ?, 1)`,
        )
        .run(crypto.randomUUID(), ghostId, p.email.toLowerCase().trim());
    }
    if (p.phone) {
      sqlite
        .prepare(
          `INSERT INTO contact_phones (id, contactId, phone, isPrimary)
           VALUES (?, ?, ?, 1)`,
        )
        .run(crypto.randomUUID(), ghostId, normalizePhone(p.phone));
    }
    recordEvent(scope, "contact.created", ghostId, {
      origin: "connector",
      autoEnrich: false,
    });
    matcher.registerContact(
      ghostId,
      p.email ? [p.email] : [],
      p.phone ? [p.phone] : [],
    );
    stats.ghosts = (stats.ghosts ?? 0) + 1;
    return ghostId;
  }

  /**
   * A synced person the connector already links. A contact the sync made is
   * the source's to write, emails and phones included. One the sync only
   * linked, because it shared an address, is the owner's: the sync fills what
   * is empty and adds the addresses it has, and changes nothing else.
   */
  function syncLinkedContact(
    contactId: string,
    remote: ContactPayload,
    externalId: string,
  ): void {
    try {
      if (madeBySync(contactId, externalId)) {
        contactService.updateContact(scope, contactId, remote);
        return;
      }
      const local = contactService.getContactById(scope, contactId);
      const fill = local ? fillFromRemote(local, remote) : null;
      if (fill) contactService.updateContact(scope, contactId, fill);
    } catch {
      // The contact was removed, or the update failed.
    }
  }

  function processSingleEvent(raw: SyncEvent, nowIso: string): void {
    const event = capped(raw);
    if (event.kind === "progress") {
      stats.fetched = event.fetched;
      return;
    }

    if (event.kind === "contact_deleted") {
      const link = sqlite
        .prepare(
          `SELECT localId FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
        )
        .get(connector.id, scope.ownerId, event.externalId) as
        { localId: string | null } | undefined;
      if (!link) return;
      // To the trash, where the owner can bring it back. A contact the sync
      // only linked stays, and only the link goes.
      if (link.localId && madeBySync(link.localId, event.externalId)) {
        try {
          contactService.deleteContact(scope, link.localId);
        } catch {
          // Already gone.
        }
      }
      sqlite
        .prepare(
          `DELETE FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
        )
        .run(connector.id, scope.ownerId, event.externalId);
      return;
    }

    if (event.kind === "upcoming_cancelled") {
      sqlite
        .prepare(
          `DELETE FROM upcoming_events WHERE connectorId = ? AND ownerId = ? AND externalId = ?`,
        )
        .run(connector.id, scope.ownerId, event.externalId);
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
      if (event.type === "meeting") {
        sqlite
          .prepare(
            `DELETE FROM upcoming_events WHERE connectorId = ? AND ownerId = ? AND externalId = ?`,
          )
          .run(connector.id, scope.ownerId, event.externalId);
      }
      // 1. Check idempotency via connector_links, under the id the event has
      // now or one an earlier version gave it.
      const knownIds = [event.externalId, ...(event.legacyExternalIds ?? [])];
      const existingLink = sqlite
        .prepare(
          `SELECT externalId, localId, seenCount
           FROM connector_links
           WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction'
             AND externalId IN (${knownIds.map(() => "?").join(", ")})
           ORDER BY externalId = ? DESC
           LIMIT 1`,
        )
        .get(connector.id, scope.ownerId, ...knownIds, event.externalId) as
        | { externalId: string; localId: string | null; seenCount: number }
        | undefined;

      if (existingLink) {
        if (existingLink.externalId !== event.externalId) {
          sqlite
            .prepare(
              `UPDATE connector_links SET externalId = ?
               WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction' AND externalId = ?`,
            )
            .run(
              event.externalId,
              connector.id,
              scope.ownerId,
              existingLink.externalId,
            );
        }
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
        // No contact matched: count the strangers, unless this is a
        // notification or a broadcast.
        const strangers =
          match.unknownParticipants.length > MAX_STRANGERS_PER_EVENT
            ? []
            : match.unknownParticipants.filter(
                (p) => !(p.email && BULK_SENDER.test(p.email)),
              );
        for (const p of strangers) {
          const rawId =
            p.email?.toLowerCase().trim() ||
            (p.phone ? normalizePhone(p.phone) : null) ||
            p.name?.trim();

          if (!rawId) continue;
          const externalId = rawId;
          // Kept with the link, so "Add as contact" can use it.
          const displayName = givenName(p);

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
                 SET seenCount = ?, lastSeenAt = ?, displayName = COALESCE(?, displayName)
                 WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND externalId = ?`,
              )
              .run(
                newSeen,
                nowIso,
                displayName,
                connector.id,
                scope.ownerId,
                externalId,
              );

            if (!row.ignoredAt && !row.localId) {
              if (newSeen >= ghostThreshold) {
                const ghostId = createGhost(p, nowIso);
                sqlite
                  .prepare(
                    `UPDATE connector_links
                     SET localId = ?
                     WHERE connectorId = ? AND ownerId = ? AND kind = 'correspondent' AND externalId = ?`,
                  )
                  .run(ghostId, connector.id, scope.ownerId, externalId);
              }
            }
          } else {
            // First time seen
            if (ghostThreshold <= 1) {
              const ghostId = createGhost(p, nowIso);
              sqlite
                .prepare(
                  `INSERT INTO connector_links (
                    connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt, displayName
                  ) VALUES (?, ?, 'correspondent', ?, ?, 1, ?, ?)`,
                )
                .run(
                  connector.id,
                  scope.ownerId,
                  externalId,
                  ghostId,
                  nowIso,
                  displayName,
                );
            } else {
              sqlite
                .prepare(
                  `INSERT INTO connector_links (
                    connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt, displayName
                  ) VALUES (?, ?, 'correspondent', ?, NULL, 1, ?, ?)`,
                )
                .run(
                  connector.id,
                  scope.ownerId,
                  externalId,
                  nowIso,
                  displayName,
                );
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

      const cPayload = { ...(event.contact as ContactPayload) };
      // A person with an address and no name keeps the name the contact has.
      if (!cPayload.name) delete cPayload.name;
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
        let targetLocalId = existingLink.localId;
        for (let depth = 0; depth < 10; depth++) {
          const canonRow = sqlite
            .prepare(
              `SELECT canonicalId FROM contacts WHERE id = ? AND ownerId = ?`,
            )
            .get(targetLocalId, scope.ownerId) as
            { canonicalId: string | null } | undefined;
          if (!canonRow?.canonicalId || canonRow.canonicalId === targetLocalId)
            break;
          targetLocalId = canonRow.canonicalId;
        }

        const prevAvatarRow = cPayload.avatarUrl
          ? (sqlite
              .prepare(
                `SELECT avatarUrl FROM contacts WHERE id = ? AND ownerId = ?`,
              )
              .get(targetLocalId, scope.ownerId) as
              { avatarUrl: string | null } | undefined)
          : undefined;
        const prevAvatarUrl = prevAvatarRow?.avatarUrl ?? null;

        syncLinkedContact(targetLocalId, cPayload, event.externalId);

        if (
          prevAvatarUrl &&
          cPayload.avatarUrl &&
          prevAvatarUrl !== cPayload.avatarUrl &&
          prevAvatarUrl.startsWith(`/uploads/u/${scope.ownerId}/avatars/`)
        ) {
          const stillUsed = sqlite
            .prepare(
              `SELECT 1 FROM contacts WHERE ownerId = ? AND avatarUrl = ? LIMIT 1`,
            )
            .get(scope.ownerId, prevAvatarUrl);
          if (!stillUsed) {
            const oldFile = path.join(
              ownerUploadDir(scope.ownerId, "avatars"),
              path.basename(prevAvatarUrl),
            );
            try {
              if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            } catch {
              // ignore unlink error
            }
          }
        }

        ingestedContactIds.add(targetLocalId);
        sqlite
          .prepare(
            `UPDATE connector_links
             SET localId = ?, seenCount = seenCount + 1, lastSeenAt = ?
             WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
          )
          .run(
            targetLocalId,
            nowIso,
            connector.id,
            scope.ownerId,
            event.externalId,
          );
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
          cPayload.name ||= cEmails[0] || cPhones[0] || "Unknown";
          cPayload.sources = [
            {
              platform: connector.kind,
              externalId: event.externalId,
              connectedOn: nowIso,
            },
          ];
          // No `autoEnrich`: a sync adds contacts that nobody chose one by
          // one, so "Enrich new contacts automatically" leaves them alone.
          const created = contactService.createContact(
            scope,
            cPayload as ContactPayload & { name: string },
            connector.kind,
          );
          if (created) {
            contactId = created.id;
          }
        }

        if (contactId) {
          ingestedContactIds.add(contactId);
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

  // Process the stream in batches of `BATCH_SIZE` per transaction. The photo
  // download is async and the transaction is synchronous, so the copy is made
  // first: a contact event with a photo enters the batch as a promise of the
  // same event with the local URL, or with no photo. The batch waits for all of
  // them before its transaction opens, so it never sees a remote URL, and the
  // events keep the adapter's order.
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

    if (batch.length >= BATCH_SIZE) {
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
      dispatchEvents();
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
    dispatchEvents();
  }

  // Refresh upcoming events: remove stale upcoming events for this connector.
  // ICS feeds always return the full calendar snapshot, whereas Google Calendar
  // uses incremental `syncToken` deltas and only yields changed/cancelled events.
  if (connector.kind === "google") {
    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    sqlite.transaction(() => {
      if (connector.config.syncCalendar === false) {
        sqlite
          .prepare(
            `DELETE FROM upcoming_events WHERE connectorId = ? AND ownerId = ?`,
          )
          .run(connector.id, scope.ownerId);
      } else {
        sqlite
          .prepare(
            `DELETE FROM upcoming_events
             WHERE connectorId = ? AND ownerId = ?
               AND ((length(endsAt) = 10 AND endsAt <= ?) OR (length(endsAt) > 10 AND endsAt < ?))`,
          )
          .run(connector.id, scope.ownerId, todayIso, nowIso);
      }
    })();
  } else if (hasUpcomingEvents || connector.kind === "ics") {
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

  return { stats, ingestedContactIds };
}
