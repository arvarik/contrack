/**
 * Event ingestion for connectors. It consumes the SyncEvents adapters yield:
 * 1. Matches participants to contacts (ContactMatcher).
 * 2. Deduplicates by externalId through connector_links.
 * 3. Rolls a day up by contactId:YYYY-MM-DD.
 * 4. Counts unknown participants as correspondents, one per mailbox and once
 *    per mail or meeting, and promotes them to ghost contacts past
 *    ghostThreshold. Bulk mail, a robot or relay sender and a broadcast to
 *    many strangers count nobody.
 * 5. Writes a synced person over the contact the sync made for it, or over a
 *    suggested person it names, and only fills in a contact the sync linked
 *    by a shared address. Trashes the former when its source deletes it, and
 *    unlinks the latter.
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
import { getErrorMessage } from "../utils/helpers.ts";
import { ownerUploadDir, ownerUploadUrl } from "../utils/paths.ts";
import { defaultAvatarUrl, isDefaultAvatarFor } from "../utils/avatarUrl.ts";
import { isBase64DataUri, saveBase64Avatar } from "../utils/avatarProcessor.ts";
import { ValidationError } from "../utils/AppError.ts";
import {
  ensureLocalImage,
  imageHost,
  isTransientImageError,
  urlDigest,
} from "../utils/remoteImage.ts";
import type { ContactMatcher } from "./matching.ts";
import type { SyncEvent } from "./types.ts";
import { canonicalEmailAddress, isAutomatedSender } from "./email/normalize.ts";
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
  /** The messages of the stages that failed while the rest went on. */
  failures: string[];
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

/** The addresses a payload's email or phone list names, without blanks. */
function payloadValues(list: unknown, key: "email" | "phone"): string[] {
  return Array.isArray(list)
    ? list
        .map((entry) => payloadValue(entry, key))
        .filter((value): value is string => Boolean(value))
    : [];
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
    // Every contact gets a drawn avatar when it is made, so for the photo
    // that default counts as empty.
    const empty =
      current == null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0) ||
      (key === "avatarUrl" &&
        isDefaultAvatarFor(current as string, local.name));
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

/** Contact avatars: 256 px square, the size saveBase64Avatar writes. */
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

/** The file a remote photo is saved as: the digest of its URL. */
function photoFileName(remoteUrl: string): string {
  return `remote-${urlDigest(remoteUrl)}.jpg`;
}

/**
 * Copy a connector's contact photo into the owner's avatars folder and return
 * the local URL. A browser that loads a googleusercontent.com URL tells Google
 * each time somebody opens the contact. The copy is re-encoded like
 * saveBase64Avatar: a 256 px cover JPEG. The file name is the digest of the
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
  const filename = photoFileName(remoteUrl);
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
 * the sync's own abort, which is rethrown so the run stops. `onNotRead` hears
 * of a photo that will not read on another try either, such as a HEIC photo,
 * so the run can count it. A network failure is not counted, and nor is a
 * failure of the server's own, such as a full disk.
 */
async function localContactPhoto(
  scope: Scope,
  remoteUrl: string,
  signal: AbortSignal | undefined,
  onNotRead: () => void,
): Promise<string | undefined> {
  if (isBase64DataUri(remoteUrl)) {
    try {
      return await saveBase64Avatar(scope, remoteUrl);
    } catch (err) {
      const detail = `Inline contact photo was not saved: ${getErrorMessage(err)}`;
      if (err instanceof ValidationError) {
        log.debug("Connectors", detail);
        onNotRead();
      } else {
        log.warn("Connectors", detail);
      }
      return undefined;
    }
  }
  try {
    return await saveContactPhoto(scope, remoteUrl, signal);
  } catch (err) {
    signal?.throwIfAborted();
    // The host only: a photo URL carries an access token in its path.
    const detail = `Contact photo from ${imageHost(remoteUrl)} was not saved: ${getErrorMessage(err)}`;
    if (isTransientImageError(err)) {
      log.warn("Connectors", detail);
    } else {
      log.debug("Connectors", detail);
      onNotRead();
    }
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

/** A list the API caps at 100 items, as `childRecordsSchema` does. */
const MAX_SYNCED_ITEMS = 100;
/** A tag, as the API caps one. */
const MAX_SYNCED_TAG = 100;

/**
 * A synced person within the API's limits: a card is the server's, and one
 * card held 40,000 addresses. A name keeps 300 characters, another field
 * 20,000, and a list 100 items.
 */
function cappedContact(contact: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contact)) {
    if (typeof value === "string") {
      out[key] = value.slice(
        0,
        key === "name" ? MAX_SYNCED_TITLE : MAX_SYNCED_CONTENT,
      );
    } else if (Array.isArray(value)) {
      const items = value.slice(0, MAX_SYNCED_ITEMS);
      out[key] =
        key === "tags"
          ? items.map((t) =>
              typeof t === "string" ? t.slice(0, MAX_SYNCED_TAG) : t,
            )
          : items;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function capped(event: SyncEvent): SyncEvent {
  if (event.kind === "contact") {
    return { ...event, contact: cappedContact(event.contact) };
  }
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

  /** The owner's other connectors of this kind: two Google accounts. */
  const siblingConnectorIds = (
    sqlite
      .prepare(
        `SELECT id FROM connectors WHERE ownerId = ? AND kind = ? AND id != ?`,
      )
      .all(scope.ownerId, connector.kind, connector.id) as Array<{ id: string }>
  ).map((r) => r.id);
  const seenUpcomingExternalIds = new Set<string>();
  const ingestedContactIds = new Set<string>();
  const failures: string[] = [];
  let hasUpcomingEvents = false;
  let upcomingListed = false;

  /** The link of the card `externalId` to a contact, if the card has one. */
  function contactLink(externalId: string) {
    return sqlite
      .prepare(
        `SELECT localId FROM connector_links
         WHERE connectorId = ? AND ownerId = ? AND kind = 'contact' AND externalId = ?`,
      )
      .get(connector.id, scope.ownerId, externalId) as
      { localId: string | null } | undefined;
  }

  /** When this connector was made: a source row from before is another's. */
  const connectorCreatedAt =
    (
      sqlite
        .prepare(
          `SELECT createdAt FROM connectors WHERE id = ? AND ownerId = ?`,
        )
        .get(connector.id, scope.ownerId) as { createdAt: string } | undefined
    )?.createdAt ?? null;

  /**
   * Whether this source owns the contact's details for this external id: its
   * source row names the connector's kind and the id, and this connector's
   * pull or push made it. Not a row from before the connector: a connector
   * removed and added back finds its old contacts the owner's. Not when the
   * contact took in another one by a merge, which moves the duplicate's
   * source row to it. Then the contact is the owner's, and the source only
   * fills it in. Another link also decides it:
   * - A card the source brought in (origin NULL) stops writing only when
   *   another card that brought the contact in feeds it. A card that only
   *   shares an address with it, or a copy Contrack uploaded, does not count.
   * - A card Contrack uploaded (origin 'push') writes only while no other card
   *   feeds the contact, so two uploaded copies never write over it.
   */
  function madeBySync(contactId: string, externalId: string): boolean {
    return Boolean(
      sqlite
        .prepare(
          `SELECT 1 FROM contact_sources s
           WHERE s.contactId = ? AND s.platform = ? AND s.externalId = ?
             AND (? IS NULL OR
               julianday(COALESCE(s.connectedOn, s.importedAt)) >= julianday(?))
             AND NOT EXISTS (
               SELECT 1 FROM dedupe_merge_log m
               WHERE m.ownerId = ? AND m.primaryId = s.contactId AND m.undoneAt IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM connector_links l
               WHERE l.ownerId = ? AND l.kind = 'contact' AND l.localId = s.contactId
                 AND NOT (l.connectorId = ? AND l.externalId = ?)
                 AND (s.origin IS 'push' OR EXISTS (
                   SELECT 1 FROM contact_sources o
                   WHERE o.contactId = l.localId AND o.externalId = l.externalId
                     AND o.origin IS NOT 'push')))`,
        )
        .get(
          contactId,
          connector.kind,
          externalId,
          connectorCreatedAt,
          connectorCreatedAt,
          scope.ownerId,
          scope.ownerId,
          connector.id,
          externalId,
        ),
    );
  }

  /**
   * The contact a card with no link already made: a connector removed and
   * added back finds its old contacts by their source rows, and a card that
   * Contrack uploaded carries the contact's id as its UID, when the run
   * stopped before it saved the link. Matching them keeps the card from
   * coming in a second time.
   */
  function knownCardContact(
    externalId: string,
    uid: unknown,
  ): { id: string; byUid: boolean } | null {
    const row = sqlite
      .prepare(
        `SELECT id FROM contacts
         WHERE ownerId = ? AND deletedAt IS NULL AND (
           id = ? OR id IN (
             SELECT contactId FROM contact_sources
             WHERE platform = ? AND externalId = ?))
         ORDER BY id = ? DESC
         LIMIT 1`,
      )
      .get(
        scope.ownerId,
        typeof uid === "string" ? uid : null,
        connector.kind,
        externalId,
        typeof uid === "string" ? uid : null,
      ) as { id: string } | undefined;
    return row ? { id: survivor(row.id), byUid: row.id === uid } : null;
  }

  /** The contact a merge kept in place of `contactId`, or the contact. */
  function survivor(contactId: string): string {
    let id = contactId;
    for (let depth = 0; depth < 10; depth++) {
      const row = sqlite
        .prepare(
          `SELECT canonicalId FROM contacts WHERE id = ? AND ownerId = ?`,
        )
        .get(id, scope.ownerId) as { canonicalId: string | null } | undefined;
      if (!row?.canonicalId || row.canonicalId === id) break;
      id = row.canonicalId;
    }
    return id;
  }

  /**
   * A card with no photo takes back the photo an earlier sync saved from a
   * card: a copy the sync makes is named `import-` or `remote-`, and a photo
   * the owner chose has another name. Never for a card Contrack uploaded: it
   * is written without the photo, which may be one the owner imported.
   */
  function dropSavedPhoto(contactId: string, externalId: string) {
    const uploaded = sqlite
      .prepare(
        `SELECT 1 FROM contact_sources
         WHERE contactId = ? AND platform = ? AND externalId = ? AND origin = 'push'`,
      )
      .get(contactId, connector.kind, externalId);
    if (uploaded) return;
    const row = sqlite
      .prepare(
        `SELECT name, pronouns, avatarUrl FROM contacts WHERE id = ? AND ownerId = ?`,
      )
      .get(contactId, scope.ownerId) as
      | { name: string; pronouns: string | null; avatarUrl: string | null }
      | undefined;
    const saved = `/uploads/u/${scope.ownerId}/avatars/`;
    if (
      row?.avatarUrl?.startsWith(`${saved}import-`) ||
      row?.avatarUrl?.startsWith(`${saved}remote-`)
    ) {
      contactService.updateContact(scope, contactId, {
        avatarUrl: defaultAvatarUrl(row.name, row.pronouns),
      });
    }
  }

  /**
   * A ghost contact for a stranger seen often enough, with the address the
   * mail or meeting gave. Recorded like every created contact, so the search
   * index, the duplicate check and the score see it. Runs inside the batch
   * transaction, as recordEvent requires.
   */
  function createGhost(p: Participant, nowIso: string): string {
    const ghostName = p.name || p.email || p.phone || "Unknown";
    const ghostId = crypto.randomUUID();
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
        .run(crypto.randomUUID(), ghostId, p.phone.trim());
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
   * Google's labels and links added to the ones a contact has. Google is
   * pull-only, so the tags the owner gives a contact and the links research
   * finds never reach the card, and a change to the card must not drop them.
   * CardDAV can push them to the card, and its card still replaces them.
   */
  function withLocalTagsAndLinks(
    contactId: string,
    remote: ContactPayload,
  ): ContactPayload {
    if (connector.kind !== "google") return remote;
    const out = { ...remote };
    if (remote.tags) {
      const tags = sqlite
        .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
        .pluck()
        .all(contactId) as string[];
      out.tags = [...tags, ...remote.tags];
    }
    if (remote.socialLinks) {
      const links = sqlite
        .prepare(
          "SELECT platform, url, handle FROM contact_social_links WHERE contactId = ?",
        )
        .all(contactId) as Array<{
        platform: string;
        url: string;
        handle: string | null;
      }>;
      const known = new Set(links.map((l) => l.url.toLowerCase()));
      out.socialLinks = [
        ...links.map((l) => ({ ...l, handle: l.handle ?? undefined })),
        ...remote.socialLinks.filter(
          (l) => !known.has((typeof l === "string" ? l : l.url).toLowerCase()),
        ),
      ];
    }
    return out;
  }

  /**
   * Puts the drawn avatar back on a contact whose photo is the saved copy of
   * this card's placeholder. Before the adapter could tell Google's letter
   * tile from a photo, a sync saved the tile like one. The copy's file name is
   * the digest of the URL it came from, so a match proves the photo is that
   * tile. The owner's own photos have other names and never match.
   */
  function restoreDrawnAvatar(contactId: string, placeholderUrl: string) {
    const row = sqlite
      .prepare(
        `SELECT name, pronouns, avatarUrl FROM contacts WHERE id = ? AND ownerId = ?`,
      )
      .get(contactId, scope.ownerId) as
      | { name: string; pronouns: string | null; avatarUrl: string | null }
      | undefined;
    const copy = `/uploads/u/${scope.ownerId}/avatars/${photoFileName(placeholderUrl)}`;
    if (row && row.avatarUrl === copy) {
      contactService.updateContact(scope, contactId, {
        avatarUrl: defaultAvatarUrl(row.name, row.pronouns),
      });
    }
  }

  /**
   * A synced person the connector already links. A contact the sync made is
   * the source's to write, emails and phones included. A suggested person
   * (ghost) the card matches becomes such a contact: the owner saved them in
   * their address book. Any other contact the sync only linked, because it
   * shared an address, is the owner's: the sync fills what is empty and adds
   * the addresses it has, and changes nothing else.
   */
  function syncLinkedContact(
    contactId: string,
    remote: ContactPayload,
    externalId: string,
    placeholderUrl?: string,
    noPhoto?: boolean,
  ): void {
    try {
      if (placeholderUrl) restoreDrawnAvatar(contactId, placeholderUrl);
      if (madeBySync(contactId, externalId)) {
        contactService.updateContact(
          scope,
          contactId,
          withLocalTagsAndLinks(contactId, remote),
        );
        if (noPhoto) dropSavedPhoto(contactId, externalId);
        return;
      }
      const local = contactService.getContactById(scope, contactId);
      if (local?.isGhost) {
        contactService.updateContact(scope, contactId, {
          ...withLocalTagsAndLinks(contactId, remote),
          isGhost: false,
        });
        // The source row that madeBySync reads, so later edits to the card
        // apply.
        sqlite
          .prepare(
            `INSERT INTO contact_sources (id, contactId, platform, externalId, connectedOn)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            crypto.randomUUID(),
            contactId,
            connector.kind,
            externalId,
            new Date().toISOString(),
          );
        return;
      }
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

    if (event.kind === "stage_failed") {
      stats.errors = (stats.errors ?? 0) + 1;
      failures.push(event.message);
      return;
    }

    if (event.kind === "contact_deleted") {
      const link = contactLink(event.externalId);
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

    if (event.kind === "upcoming_listed") {
      upcomingListed = true;
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

      // A link with no interaction is a mail or a meeting that matched no
      // contact: its strangers were counted when it came. It is logged once
      // a contact matches, and its strangers never count again.
      const countedHere = existingLink?.localId === null;
      let counted = countedHere;
      if (countedHere) {
        sqlite
          .prepare(
            `DELETE FROM connector_links
             WHERE connectorId = ? AND ownerId = ? AND kind = 'interaction' AND externalId = ?`,
          )
          .run(connector.id, scope.ownerId, existingLink.externalId);
      } else if (existingLink) {
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

      // The same mail or invite reached through another of the owner's
      // connectors of this kind, such as two Google accounts on one thread,
      // is that interaction: it is linked here too, and not logged twice.
      // A sibling that saw it with no contact counted its strangers already.
      let shared: { localId: string } | undefined;
      for (const siblingId of siblingConnectorIds) {
        const row = sqlite
          .prepare(
            `SELECT localId FROM connector_links
             WHERE connectorId = ? AND kind = 'interaction' AND externalId = ?
               AND ownerId = ?`,
          )
          .get(siblingId, event.externalId, scope.ownerId) as
          { localId: string | null } | undefined;
        if (row && row.localId === null) counted = true;
        if (row?.localId) {
          shared = { localId: row.localId };
          break;
        }
      }
      if (shared) {
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
            shared.localId,
            nowIso,
          );
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
        // No contact matched: count the strangers, unless this is bulk mail
        // or a broadcast. A robot or a relay is never one (`isAutomatedSender`).
        const strangers =
          counted ||
          event.automated ||
          match.unknownParticipants.length > MAX_STRANGERS_PER_EVENT
            ? []
            : match.unknownParticipants.filter(
                (p) => !(p.email && isAutomatedSender(p.email, p.name)),
              );
        for (const p of strangers) {
          // By mailbox, so the spellings of one address are one stranger.
          const rawId =
            (p.email ? canonicalEmailAddress(p.email) : "") ||
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
        // Kept with no interaction, so a mail or a meeting read again counts
        // its strangers once. An ICS feed gives every past meeting on each run.
        sqlite
          .prepare(
            `INSERT INTO connector_links (
              connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt
            ) VALUES (?, ?, 'interaction', ?, NULL, 1, ?)`,
          )
          .run(connector.id, scope.ownerId, event.externalId, nowIso);
        if (counted) stats.skipped = (stats.skipped ?? 0) + 1;
      }
      return;
    }

    if (event.kind === "contact") {
      const existingLink = contactLink(event.externalId);

      const cPayload = { ...(event.contact as ContactPayload) };
      // A person with an address and no name keeps the name the contact has.
      if (!cPayload.name) delete cPayload.name;
      const cEmails = payloadValues(cPayload.emails, "email");
      const cPhones = payloadValues(cPayload.phones, "phone");

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
        const targetLocalId = survivor(existingLink.localId);

        const prevAvatarRow = cPayload.avatarUrl
          ? (sqlite
              .prepare(
                `SELECT avatarUrl FROM contacts WHERE id = ? AND ownerId = ?`,
              )
              .get(targetLocalId, scope.ownerId) as
              { avatarUrl: string | null } | undefined)
          : undefined;
        const prevAvatarUrl = prevAvatarRow?.avatarUrl ?? null;

        syncLinkedContact(
          targetLocalId,
          cPayload,
          event.externalId,
          event.defaultPhotoUrl,
          event.noPhoto,
        );

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
        const known = knownCardContact(event.externalId, cPayload.uid);
        let matchedContactId = known?.id ?? null;
        if (known?.byUid) {
          // The card this connector's push made, when the run stopped before
          // it saved the source row: saved now, so later edits on the server
          // apply. A card an earlier connector uploaded keeps its old row,
          // and a connector added back only fills its contact in.
          sqlite
            .prepare(
              `INSERT INTO contact_sources (id, contactId, platform, externalId, connectedOn, origin)
               SELECT ?, ?, ?, ?, ?, 'push'
               WHERE NOT EXISTS (
                 SELECT 1 FROM contact_sources s JOIN contacts c ON c.id = s.contactId
                 WHERE c.ownerId = ? AND s.platform = ? AND s.externalId = ?)`,
            )
            .run(
              crypto.randomUUID(),
              matchedContactId,
              connector.kind,
              event.externalId,
              nowIso,
              scope.ownerId,
              connector.kind,
              event.externalId,
            );
        }
        for (const em of matchedContactId ? [] : cEmails) {
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
        // A first match fills in at once: a source sends an unchanged person
        // only once, so a fill left for a later sync never came.
        if (contactId) {
          syncLinkedContact(
            contactId,
            cPayload,
            event.externalId,
            event.defaultPhotoUrl,
          );
        } else {
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
  /** Writes the batch in one transaction once its photos are local. */
  const flush = async () => {
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
  };

  for await (const event of stream) {
    signal?.throwIfAborted();
    if (event.kind === "contact" && event.photoUrl) {
      const remoteUrl = event.photoUrl;
      const ready = photoSlot(async (): Promise<SyncEvent> => ({
        ...event,
        photoUrl: await localContactPhoto(scope, remoteUrl, signal, () => {
          stats.photosNotRead = (stats.photosNotRead ?? 0) + 1;
        }),
      }));
      // Only an abort rejects, and the Promise.all in flush reports it. This handler
      // keeps a rejection that lands before the batch is awaited from being
      // reported as unhandled, which would stop the process.
      ready.catch(() => undefined);
      batch.push(ready);
    } else {
      batch.push(event);
    }

    if (batch.length >= BATCH_SIZE) await flush();
  }

  if (batch.length > 0) await flush();

  // Refresh upcoming events: remove stale upcoming events for this connector.
  // An ICS feed is the whole calendar, and a Google run that listed its window
  // (`upcoming_listed`) yielded all of it, so a row the run did not yield is
  // gone. A Google run that did not list it, with Calendar off or failed,
  // removes every row or the ended ones.
  if (connector.kind === "google" && !upcomingListed) {
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
  } else if (hasUpcomingEvents || upcomingListed || connector.kind === "ics") {
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

  return { stats, ingestedContactIds, failures };
}
